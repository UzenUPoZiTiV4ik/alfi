"""SQLite в режиме WAL: схема и короткие хелперы.

Одно соединение на поток (FastAPI выполняет синхронные обработчики в пуле потоков).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import weakref
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterable

from . import config

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
  uid TEXT PRIMARY KEY, org_type TEXT, okfs TEXT, age TEXT, eco TEXT, okved TEXT, okved_name TEXT,
  negative REAL, workers_fns TEXT, workers_spark TEXT, cl_type TEXT,
  rko REAL, gar REAL, loa REAL, lea REAL, dep REAL, zpp REAL, fts REAL, fts_country TEXT, factoring REAL,
  revenue REAL, group_id TEXT, city TEXT, region TEXT, sector TEXT
);
CREATE INDEX IF NOT EXISTS ix_comp_group ON companies(group_id);
CREATE INDEX IF NOT EXISTS ix_comp_okved ON companies(okved);
CREATE INDEX IF NOT EXISTS ix_comp_sector ON companies(sector, revenue);
CREATE INDEX IF NOT EXISTS ix_comp_rev ON companies(revenue);

CREATE TABLE IF NOT EXISTS payments (beneficiary TEXT, payer TEXT, amt REAL, cnt INTEGER);
CREATE INDEX IF NOT EXISTS ix_pay_b ON payments(beneficiary);
CREATE INDEX IF NOT EXISTS ix_pay_p ON payments(payer);

CREATE TABLE IF NOT EXISTS persons (fid TEXT, city TEXT, rc TEXT, uid TEXT);
CREATE INDEX IF NOT EXISTS ix_pers_f ON persons(fid);
CREATE INDEX IF NOT EXISTS ix_pers_u ON persons(uid);

CREATE TABLE IF NOT EXISTS group_stats (group_id TEXT PRIMARY KEY, n INTEGER, revenue REAL);

CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY, url TEXT, title TEXT, text TEXT, source TEXT, source_id TEXT, origin TEXT,
  published TEXT, fetched TEXT, cluster_id TEXT, tags_json TEXT, extract_json TEXT, user_uid TEXT
);
CREATE INDEX IF NOT EXISTS ix_news_pub ON news(published);
CREATE INDEX IF NOT EXISTS ix_news_cluster ON news(cluster_id);

CREATE TABLE IF NOT EXISTS kb_docs (
  id TEXT PRIMARY KEY, file TEXT, title TEXT, date TEXT, kind TEXT, pages INTEGER, summary TEXT,
  stale INTEGER DEFAULT 0, meta_json TEXT
);
CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY, doc_id TEXT, kind TEXT, page INTEGER, text TEXT, quote TEXT,
  quote_verified INTEGER, factors_json TEXT, sectors_json TEXT, stance TEXT, horizon TEXT, meta_json TEXT
);
CREATE INDEX IF NOT EXISTS ix_kbc_doc ON kb_chunks(doc_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, kind TEXT, uid TEXT, role TEXT, news_id TEXT, status TEXT,
  started TEXT, finished TEXT, cost_rub REAL DEFAULT 0, result_json TEXT
);
CREATE TABLE IF NOT EXISTS run_steps (
  run_id TEXT, seq INTEGER, type TEXT, title TEXT, data_json TEXT, ts TEXT, ms INTEGER
);
CREATE INDEX IF NOT EXISTS ix_steps_run ON run_steps(run_id, seq);

CREATE TABLE IF NOT EXISTS active_insights (
  uid TEXT, role TEXT, news_id TEXT, run_id TEXT NOT NULL, worker_pid INTEGER NOT NULL, PRIMARY KEY(uid,role,news_id)
);
CREATE TABLE IF NOT EXISTS insights (
  key TEXT, news_id TEXT, run_id TEXT, result_json TEXT, confidence REAL, created TEXT,
  PRIMARY KEY (key, news_id)
);
CREATE TABLE IF NOT EXISTS triage (
  key TEXT, news_id TEXT, data_json TEXT, created TEXT, PRIMARY KEY (key, news_id)
);
CREATE TABLE IF NOT EXISTS llm_reservations (id TEXT PRIMARY KEY, day TEXT NOT NULL, amount REAL NOT NULL);
CREATE INDEX IF NOT EXISTS ix_llm_res_day ON llm_reservations(day);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, day TEXT, purpose TEXT, model TEXT, run_id TEXT,
  prompt_tokens INTEGER, completion_tokens INTEGER, cost_rub REAL, ms INTEGER, ok INTEGER, error TEXT
);
CREATE INDEX IF NOT EXISTS ix_llm_day ON llm_calls(day);
CREATE TABLE IF NOT EXISTS tool_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, run_id TEXT, uid TEXT, role TEXT, tool TEXT,
  args_json TEXT, ok INTEGER, ms INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS exa_requests (day TEXT PRIMARY KEY, used INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS exa_cache (key TEXT PRIMARY KEY, endpoint TEXT, response_json TEXT, ts TEXT, day TEXT);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, uid TEXT, role TEXT, news_id TEXT, kind TEXT, value INTEGER, comment TEXT
);
CREATE TABLE IF NOT EXISTS feedback_state (
  user_uid TEXT NOT NULL, role TEXT NOT NULL, news_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('useful','not_relevant','neutral')), keys_json TEXT,
  PRIMARY KEY(user_uid, role, news_id)
);
CREATE TABLE IF NOT EXISTS feedback_totals (key TEXT PRIMARY KEY, weights_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS team_schedules (
  uid TEXT NOT NULL, role TEXT NOT NULL, member_id TEXT NOT NULL,
  frequency TEXT NOT NULL, timezone TEXT NOT NULL, next_run_at TEXT,
  PRIMARY KEY(uid, role, member_id)
);
CREATE TABLE IF NOT EXISTS content_revision (id INTEGER PRIMARY KEY CHECK(id=1), feed INTEGER NOT NULL, kb INTEGER NOT NULL);
INSERT OR IGNORE INTO content_revision VALUES(1,0,0);
CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS user_prefs (key TEXT PRIMARY KEY, weights_json TEXT, updated TEXT);
CREATE TABLE IF NOT EXISTS ingest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, started TEXT, finished TEXT, fetched INTEGER, new INTEGER,
  total INTEGER, extracted INTEGER, sources INTEGER, errors_json TEXT, cost_rub REAL
);
CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, uid TEXT, kind TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, ts TEXT);
"""


class _ThreadConnection:
    """Закрывает соединение, когда поток освобождает своё локальное хранилище."""

    def __init__(self):
        config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(config.DB_PATH, timeout=30, check_same_thread=False)
        weakref.finalize(self, connection.close)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA busy_timeout=30000")
        self.connection = connection


def conn() -> sqlite3.Connection:
    if not hasattr(_local, "owner"):
        _local.owner = _ThreadConnection()
    return _local.owner.connection


@contextmanager
def transaction():
    """Захватываем запись до чтения состояния, чтобы две команды не затёрли друг друга."""
    connection = conn()
    with connection:
        connection.execute("BEGIN IMMEDIATE")
        yield connection


def init() -> None:
    conn().executescript(SCHEMA)
    with transaction() as connection:
        # Revision counters keep feed/KB caches coherent across processes and bulk imports.
        for table in ("news", "kb_docs", "kb_chunks", "triage", "feedback_state", "insights", "kv", "team_schedules", "ingest_log", "companies"):
            assignment = "feed=feed+1,kb=kb+1" if table.startswith("kb_") else "feed=feed+1"
            for operation in ("INSERT", "UPDATE", "DELETE"):
                connection.execute(f"""CREATE TRIGGER IF NOT EXISTS rev_{table}_{operation} AFTER {operation} ON {table}
                                       BEGIN UPDATE content_revision SET {assignment} WHERE id=1; END""")
        migration = "scoped_news_feedback_v1"
        if connection.execute("SELECT 1 FROM schema_migrations WHERE name=?", (migration,)).fetchone():
            return
        columns = {row[1] for row in connection.execute("PRAGMA table_info(news)")}
        if "user_uid" not in columns:
            connection.execute("ALTER TABLE news ADD COLUMN user_uid TEXT")
        # URL и владелец уникальны вместе. Сохраняем старые id и все ссылки на них.
        connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_news_owner_url ON news(COALESCE(user_uid,''), trim(url))")
        connection.execute("""UPDATE news AS n SET cluster_id=id WHERE cluster_id IS NOT NULL
                              AND NOT EXISTS (SELECT 1 FROM news AS rep WHERE rep.id=n.cluster_id
                              AND COALESCE(rep.user_uid,'')=COALESCE(n.user_uid,''))""")
        # Старый журнал не хранил ключи факторов. При первом изменении их передаёт ranking.
        connection.execute("""INSERT OR REPLACE INTO feedback_state(user_uid,role,news_id,state)
                              SELECT uid,role,news_id,CASE kind WHEN 'undo' THEN 'neutral' ELSE kind END
                              FROM feedback WHERE kind IN ('useful','not_relevant','undo')
                              AND uid IS NOT NULL AND role IS NOT NULL AND news_id IS NOT NULL ORDER BY id""")
        connection.execute("INSERT INTO schema_migrations(name) VALUES(?)", (migration,))


def q(sql: str, args: Iterable[Any] = ()) -> list[dict]:
    return [dict(r) for r in conn().execute(sql, tuple(args)).fetchall()]


def q1(sql: str, args: Iterable[Any] = ()) -> dict | None:
    r = conn().execute(sql, tuple(args)).fetchone()
    return dict(r) if r else None


def ex(sql: str, args: Iterable[Any] = ()) -> int:
    c = conn()
    cur = c.execute(sql, tuple(args))
    c.commit()
    return cur.lastrowid or cur.rowcount


def exmany(sql: str, rows: Iterable[Iterable[Any]]) -> None:
    c = conn()
    c.executemany(sql, rows)
    c.commit()


def j(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def unj(s: str | None, default: Any = None) -> Any:
    if not s:
        return default
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return default


def is_news_visible(item: dict, uid: str | None) -> bool:
    """Эквивалент SQL-предиката для записей поискового индекса с полем user_uid."""
    owner = item["user_uid"]
    return not owner or owner == uid


def news_visibility_clause(uid: str | None, alias: str = "") -> tuple[str, tuple]:
    """SQL-предикат и параметры. Псевдоним таблицы задаёт вызывающий запрос."""
    if alias and not alias.isidentifier():
        raise ValueError("Недопустимый псевдоним таблицы news")
    owner = (alias + "." if alias else "") + "user_uid"
    return f"(COALESCE({owner},'') IN ('', ?))", (uid or "",)


_FEEDBACK_DELTA = {"useful": 0.15, "not_relevant": -0.2, "neutral": 0.0}


def set_feedback(uid: str, role: str, news_id: str, kind: str, keys: Iterable[str] = ()) -> dict:
    """Применить целевое состояние; undo снимает скрытие, undo_useful снимает лайк."""
    undo = {"undo": "not_relevant", "undo_useful": "useful"}
    if kind not in _FEEDBACK_DELTA and kind not in undo:
        raise ValueError("Неизвестная команда оценки")
    key = f"{uid}|{role}"
    address = (uid, role, news_id)
    keys = list(dict.fromkeys(keys))
    visible, args = news_visibility_clause(uid)
    with transaction() as connection:
        if not q1(f"SELECT 1 FROM news WHERE id=? AND {visible}", (news_id, *args)):
            raise ValueError("Новость не найдена")
        prev = q1("SELECT state,keys_json FROM feedback_state WHERE user_uid=? AND role=? AND news_id=?", address)
        old_state = prev["state"] if prev else "neutral"
        new_state = kind
        if kind in undo:
            new_state = "neutral" if old_state == undo[kind] else old_state
        prefs = q1("SELECT weights_json FROM user_prefs WHERE key=?", (key,))
        weights = unj(prefs["weights_json"], {}) if prefs else {}
        if new_state == old_state:
            return {"state": old_state, "weights": weights}

        # Храним сумму до ограничения диапазона: снятие оценки обратимо даже при насыщении веса.
        raw = q1("SELECT weights_json FROM feedback_totals WHERE key=?", (key,))
        totals = unj(raw["weights_json"]) if raw else dict(weights)
        old_keys = unj(prev["keys_json"], [k for k in keys if k in weights]) if prev else []
        new_keys = keys if new_state != "neutral" else []
        for factor in set(old_keys) | set(new_keys):
            previous = _FEEDBACK_DELTA[old_state] if factor in old_keys else 0.0
            current = _FEEDBACK_DELTA[new_state] if factor in new_keys else 0.0
            totals[factor] = round(totals.get(factor, 1.0) + current - previous, 3)
        weights = {k: min(1.6, max(0.3, v)) for k, v in totals.items()}
        ts = datetime.now(timezone.utc).isoformat()
        connection.execute("INSERT OR REPLACE INTO feedback_state VALUES(?,?,?,?,?)", (*address, new_state, j(new_keys)))
        connection.execute("INSERT OR REPLACE INTO feedback_totals VALUES(?,?)", (key, j(totals)))
        connection.execute("INSERT OR REPLACE INTO user_prefs VALUES(?,?,?)", (key, j(weights), ts))
        connection.execute("INSERT INTO feedback(ts,uid,role,news_id,kind) VALUES(?,?,?,?,?)", (ts, *address, kind))
        return {"state": new_state, "weights": weights}


def kv_get(k: str, default: Any = None) -> Any:
    r = q1("SELECT v FROM kv WHERE k=?", (k,))
    return unj(r["v"], default) if r else default


def kv_set(k: str, v: Any) -> None:
    ex("INSERT OR REPLACE INTO kv(k,v,ts) VALUES(?,?,?)", (k, j(v), datetime.now(timezone.utc).isoformat()))


def kv_del(k: str) -> None:
    ex("DELETE FROM kv WHERE k=?", (k,))
