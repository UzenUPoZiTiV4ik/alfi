"""Служба загрузки новостей, фонового планировщика и пользовательской отправки событий.

Вынесена из HTTP-слоя (main.py), чтобы веб-обработчики не управляли потоками, БД и внешними запросами напрямую.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from . import config, dates, db, exa, kb, news, ranking, security


def is_stale() -> bool:
    last = db.last_ingest_summary()
    if not last or not last.get("finished"):
        return True
    finished = dates.parse_utc_safe(last["finished"])
    age = (datetime.now(timezone.utc) - finished).total_seconds() / 60
    return age >= max(5, config.INGEST_INTERVAL_MIN)


def scheduler_loop() -> None:
    """Новости собираются сами: при старте, если данные устарели, и дальше по расписанию."""
    if config.INGEST_ON_START or is_stale():
        try:
            news.ingest()
        except Exception:  # noqa: BLE001 сбор повторится в следующий раз
            pass
    while config.INGEST_INTERVAL_MIN > 0:
        time.sleep(60)
        if is_stale() and not news.ingest_running():
            try:
                news.ingest()
            except Exception:  # noqa: BLE001
                pass


def warm_feeds(rows: list[dict]) -> None:
    for row in rows:
        try:
            ranking.feed(row["uid"], row["role"], triage_on=False)
        except KeyError:
            continue  # компания могла исчезнуть после нового импорта


def startup() -> None:
    """Инициализация хранилища, базы знаний, прогрева лент и фонового сборщика."""
    db.init()
    kb.ensure_loaded()
    recent = db.recent_pref_keys(limit=8)
    if recent:
        threading.Thread(target=warm_feeds, args=(recent,), daemon=True).start()
    if config.INGEST_ON_START or config.INGEST_INTERVAL_MIN > 0:
        threading.Thread(target=scheduler_loop, daemon=True).start()


def trigger_background_ingest() -> dict:
    """Неблокирующий запуск сбора новостей из служебного API."""
    if news.state()["running"]:
        return {"status": "busy"}
    threading.Thread(target=news.ingest, daemon=True).start()
    return {"status": "started"}


def submit_user_news(uid: str, role: str, title: str, text: str = "", url: str | None = None) -> dict:
    """Обработка пользовательской новости: подгрузка текста по URL, защита от инъекций/ПД, сохранение и скоринг."""
    clean_url = (url or "").strip() or None
    if clean_url and not clean_url.startswith(("http://", "https://")):
        raise ValueError("Ссылка должна начинаться с http(s)://")
    body_text = text or ""
    if clean_url and len(body_text) < 200:
        try:
            got = exa.contents([clean_url], chars=6000)
            if got and got[0].get("text"):
                body_text = got[0]["text"]
        except Exception:  # noqa: BLE001 работаем с тем, что ввёл пользователь
            pass
    if security.injection_score(title + " " + body_text):
        security.log_event(uid, "prompt_injection_submit", title[:200])
    clean_text, _ = security.mask_pii(body_text)
    news_id = news.submit(title, clean_text, clean_url, uid)
    scored = ranking.reasons_for(uid, role, news_id)
    return {
        "id": news_id,
        "score": round((scored or {}).get("score", 0), 3),
        "reasons": (scored or {}).get("reasons", []),
        "relevant": bool(scored and scored["score"] >= config.FEED_THRESHOLD),
    }
