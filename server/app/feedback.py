"""Правила обратной связи: влияние оценок пользователя на веса факторов и журнал отзывов.

Отделён от HTTP-слоя (main.py) и низкоуровневого слоя БД (db.py).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable

from . import db, security

FEEDBACK_DELTA: dict[str, float] = {"useful": 0.15, "not_relevant": -0.2, "neutral": 0.0}
UNDO_TARGET: dict[str, str] = {"undo": "not_relevant", "undo_useful": "useful"}
STATE_KINDS = set(FEEDBACK_DELTA) | set(UNDO_TARGET)
LOG_ONLY_KINDS = {"rating", "expert", "action"}
WEIGHT_MIN = 0.3
WEIGHT_MAX = 1.6


def pkey(uid: str, role: str) -> str:
    return f"{uid}|{role}"


def get_weights(uid: str, role: str) -> dict[str, float]:
    row = db.q1("SELECT weights_json FROM user_prefs WHERE key=?", (pkey(uid, role),))
    return db.unj(row["weights_json"], {}) if row else {}


def get_states(uid: str, role: str) -> dict[str, str]:
    rows = db.q("SELECT news_id, state FROM feedback_state WHERE user_uid=? AND role=?", (uid, role))
    return {r["news_id"]: r["state"] for r in rows}


def apply_state(uid: str, role: str, news_id: str, kind: str, keys: Iterable[str] = ()) -> dict:
    """Применяет целевое состояние (useful/not_relevant/neutral/undo/undo_useful) с обратимым пересчётом весов."""
    if kind not in STATE_KINDS:
        raise ValueError("Неизвестная команда оценки")
    key = pkey(uid, role)
    address = (uid, role, news_id)
    uniq_keys = list(dict.fromkeys(keys))
    visible, args = db.news_visibility_clause(uid)
    with db.transaction() as connection:
        if not db.q1(f"SELECT 1 FROM news WHERE id=? AND {visible}", (news_id, *args)):
            raise ValueError("Новость не найдена")
        prev = db.q1("SELECT state, keys_json FROM feedback_state WHERE user_uid=? AND role=? AND news_id=?", address)
        old_state = prev["state"] if prev else "neutral"
        new_state = kind
        if kind in UNDO_TARGET:
            new_state = "neutral" if old_state == UNDO_TARGET[kind] else old_state
        prefs = db.q1("SELECT weights_json FROM user_prefs WHERE key=?", (key,))
        weights = db.unj(prefs["weights_json"], {}) if prefs else {}
        if new_state == old_state:
            return {"state": old_state, "weights": weights}

        # Храним сырую сумму до ограничения диапазона: снятие оценки обратимо даже при насыщении веса.
        raw = db.q1("SELECT weights_json FROM feedback_totals WHERE key=?", (key,))
        totals = db.unj(raw["weights_json"]) if raw else dict(weights)
        old_keys = db.unj(prev["keys_json"], [k for k in uniq_keys if k in weights]) if prev else []
        new_keys = uniq_keys if new_state != "neutral" else []
        for factor in set(old_keys) | set(new_keys):
            previous = FEEDBACK_DELTA[old_state] if factor in old_keys else 0.0
            current = FEEDBACK_DELTA[new_state] if factor in new_keys else 0.0
            totals[factor] = round(totals.get(factor, 1.0) + current - previous, 3)
        weights = {k: min(WEIGHT_MAX, max(WEIGHT_MIN, v)) for k, v in totals.items()}
        ts = datetime.now(timezone.utc).isoformat()
        connection.execute("INSERT OR REPLACE INTO feedback_state VALUES(?,?,?,?,?)", (*address, new_state, db.j(new_keys)))
        connection.execute("INSERT OR REPLACE INTO feedback_totals VALUES(?,?)", (key, db.j(totals)))
        connection.execute("INSERT OR REPLACE INTO user_prefs VALUES(?,?,?)", (key, db.j(weights), ts))
        connection.execute("INSERT INTO feedback(ts,uid,role,news_id,kind) VALUES(?,?,?,?,?)", (ts, *address, kind))
        return {"state": new_state, "weights": weights}


def record(uid: str, role: str, news_id: str, kind: str, value: int = 0, comment: str = "",
           keys: Iterable[str] = ()) -> dict:
    """Единая точка обработки обратной связи: смена состояния ленты или запись оценки/комментария."""
    if kind in STATE_KINDS:
        return {"ok": True, **apply_state(uid, role, news_id, kind, keys)}
    if kind not in LOG_ONLY_KINDS:
        raise ValueError("Неизвестный тип обратной связи")
    clean_comment, _ = security.mask_pii(comment or "")
    db.ex(
        "INSERT INTO feedback(ts,uid,role,news_id,kind,value,comment) VALUES(?,?,?,?,?,?,?)",
        (datetime.now(timezone.utc).isoformat(), uid, role, news_id, kind, int(value or 0), clean_comment[:1000]),
    )
    return {"ok": True, "weights": None}
