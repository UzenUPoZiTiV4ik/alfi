"""Exa: только /search (type=auto) и /contents. Режимы agent, research и answer не используются.

Ответы кэшируются в SQLite (exa_cache), есть дневной лимит запросов.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

import httpx

from . import config, db

BASE = "https://api.exa.ai"


class ExaLimit(RuntimeError):
    pass


def _day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def used_today() -> int:
    row = db.q1("SELECT used FROM exa_requests WHERE day=?", (_day(),))
    return row["used"] if row else 0


def _call(endpoint: str, body: dict, ttl_h: float) -> dict:
    if endpoint not in ("/search", "/contents"):
        raise ValueError("разрешены только /search и /contents")
    key = hashlib.sha1((endpoint + db.j(body)).encode()).hexdigest()
    hit = db.q1("SELECT response_json, ts FROM exa_cache WHERE key=?", (key,))
    if hit:
        age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(hit["ts"])).total_seconds() / 3600
        if age_h < ttl_h:
            out = db.unj(hit["response_json"], {})
            out["_cached"] = True
            return out
    if not config.EXA_API_KEY:
        raise ExaLimit("EXA_API_KEY не задан")
    day = _day()
    with db.transaction() as connection:
        connection.execute("INSERT OR IGNORE INTO exa_requests VALUES(?,0)", (day,))
        claimed = connection.execute("UPDATE exa_requests SET used=used+1 WHERE day=? AND used<?",
                                     (day, config.EXA_DAILY_LIMIT))
        if not claimed.rowcount:
            raise ExaLimit("дневной лимит Exa исчерпан")
    r = httpx.post(BASE + endpoint, json=body, timeout=40,
                   headers={"x-api-key": config.EXA_API_KEY, "content-type": "application/json"})
    r.raise_for_status()
    data = r.json()
    db.ex("INSERT OR REPLACE INTO exa_cache(key,endpoint,response_json,ts,day) VALUES(?,?,?,?,?)",
          (key, endpoint, db.j(data), datetime.now(timezone.utc).isoformat(), _day()))
    return data


def search(query: str, num: int = 10, start_date: str | None = None, text_chars: int = 1500,
           ttl_h: float = 6.0) -> list[dict]:
    body: dict = {"query": query, "numResults": num, "type": "auto",
                  "contents": {"text": {"maxCharacters": text_chars}}}
    if start_date:
        body["startPublishedDate"] = start_date
    data = _call("/search", body, ttl_h)
    return [{"url": x.get("url"), "title": x.get("title") or "", "text": x.get("text") or "",
             "published": x.get("publishedDate"), "id": x.get("id")} for x in data.get("results", [])]


def contents(urls: list[str], chars: int = 4000) -> list[dict]:
    data = _call("/contents", {"ids": urls, "text": {"maxCharacters": chars}}, ttl_h=72)
    return [{"url": x.get("url"), "title": x.get("title") or "", "text": x.get("text") or "",
             "published": x.get("publishedDate")} for x in data.get("results", [])]
