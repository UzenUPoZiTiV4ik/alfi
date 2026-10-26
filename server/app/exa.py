"""exa: только /search (type=auto) и /contents, с кэшем и дневным лимитом."""
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
    return db.q1("SELECT COUNT(*) n FROM exa_cache WHERE day=?", (_day(),))["n"]


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
    if used_today() >= config.EXA_DAILY_LIMIT:
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
