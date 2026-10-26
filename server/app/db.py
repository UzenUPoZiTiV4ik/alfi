"""sqlite в режиме WAL и короткие хелперы к нему."""
from __future__ import annotations

import json
import sqlite3
import threading
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

CREATE TABLE IF NOT EXISTS insights (
  key TEXT, news_id TEXT, run_id TEXT, result_json TEXT, confidence REAL, created TEXT,
  PRIMARY KEY (key, news_id)
);
CREATE TABLE IF NOT EXISTS triage (
  key TEXT, news_id TEXT, data_json TEXT, created TEXT, PRIMARY KEY (key, news_id)
);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, day TEXT, purpose TEXT, model TEXT, run_id TEXT,
  prompt_tokens INTEGER, completion_tokens INTEGER, cost_rub REAL, ms INTEGER, ok INTEGER, error TEXT
);
CREATE INDEX IF NOT EXISTS ix_llm_day ON llm_calls(day);
CREATE TABLE IF NOT EXISTS tool_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, run_id TEXT, uid TEXT, role TEXT, tool TEXT,
  args_json TEXT, ok INTEGER, ms INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS exa_cache (key TEXT PRIMARY KEY, endpoint TEXT, response_json TEXT, ts TEXT, day TEXT);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, uid TEXT, role TEXT, news_id TEXT, kind TEXT, value INTEGER, comment TEXT
);
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


def conn() -> sqlite3.Connection:
    c = getattr(_local, "c", None)
    if c is None:
        config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(config.DB_PATH, timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("PRAGMA busy_timeout=30000")
        _local.c = c
    return c


def init() -> None:
    conn().executescript(SCHEMA)
    conn().commit()


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


def kv_get(k: str, default: Any = None) -> Any:
    r = q1("SELECT v FROM kv WHERE k=?", (k,))
    return unj(r["v"], default) if r else default


def kv_set(k: str, v: Any) -> None:
    from datetime import datetime, timezone
    ex("INSERT OR REPLACE INTO kv(k,v,ts) VALUES(?,?,?)", (k, j(v), datetime.now(timezone.utc).isoformat()))


def kv_del(k: str) -> None:
    ex("DELETE FROM kv WHERE k=?", (k,))
