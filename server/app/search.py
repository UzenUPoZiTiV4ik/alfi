"""поиск по новостям и аналитике банка: BM25 по стемам.

индексы строятся лениво и сбрасываются после сбора новостей.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

from . import db, kb, nlp
from .taxonomy import FACTORS, SECTORS

_lock = threading.Lock()
_news: dict | None = None
_kb: dict | None = None


def invalidate() -> None:
    global _news, _kb
    with _lock:
        _news = None
        _kb = None


def _news_index() -> dict:
    global _news
    with _lock:
        if _news is None:
            rows = db.q("SELECT id, title, text, source, published, cluster_id, user_uid FROM news ORDER BY published DESC")
            docs = [nlp.stems(r["title"]) * 3 + nlp.stems((r["text"] or "")[:1500]) for r in rows]
            _news = {"rows": rows, "bm": nlp.BM25(docs)}
        return _news


def _kb_index() -> dict:
    global _kb
    with _lock:
        if _kb is None:
            kb.ensure_loaded()
            rows = db.q("""SELECT c.id, c.doc_id, c.kind, c.page, c.text, c.quote, c.quote_verified, c.factors_json, c.sectors_json,
                                  c.stance, c.horizon, d.title doc_title, d.date doc_date, d.stale
                           FROM kb_chunks c JOIN kb_docs d ON d.id=c.doc_id""")
            docs = [nlp.stems(f"{r['text']} {r['quote'] or ''} {r['doc_title']}") for r in rows]
            _kb = {"rows": rows, "bm": nlp.BM25(docs)}
        return _kb


def expand(query: str, factors: list[str] | None = None, sectors: list[str] | None = None) -> list[str]:
    """Запрос + названия и ключевые слова факторов и отраслей (лексический поиск без эмбеддингов)."""
    q = nlp.stems(query)
    for f in factors or []:
        if f in FACTORS:
            q += nlp.stems(FACTORS[f]["label"]) + nlp.stems(" ".join(FACTORS[f]["words"][:5]))
    for s in sectors or []:
        if s in SECTORS:
            q += nlp.stems(SECTORS[s]["label"]) + nlp.stems(" ".join(SECTORS[s]["words"][:4]))
    return q


def search_news(query: str, k: int = 8, days: int | None = 14, exclude: set[str] | None = None,
                uid: str | None = None) -> list[dict]:
    ix = _news_index()
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat() if days else ""
    out, seen = [], set(exclude or ())
    for i, s in ix["bm"].top(nlp.stems(query), k * 6):
        r = ix["rows"][i]
        if r["id"] in seen or (r["cluster_id"] and r["cluster_id"] in seen) or (since and (r["published"] or "") < since):
            continue
        if r["user_uid"] and r["user_uid"] != uid:  # чужие пользовательские новости не видны
            continue
        seen.add(r["id"])
        if r["cluster_id"]:
            seen.add(r["cluster_id"])
        out.append({"id": f"news:{r['id']}", "news_id": r["id"], "title": r["title"], "source": r["source"],
                    "published": r["published"], "text": (r["text"] or "")[:600], "score": round(s, 2)})
        if len(out) >= k:
            break
    return out


def search_kb(query: str, k: int = 8, factors: list[str] | None = None, sectors: list[str] | None = None,
              kinds: tuple[str, ...] = ("thesis", "forecast", "para"), allow_stale: bool = True) -> list[dict]:
    """Тезисы получают буст 1,25, устаревшие документы коэффициент 0,6,
    совпадение фактора/отрасли тезиса с запросом ещё +30%."""
    ix = _kb_index()
    q = expand(query, factors, sectors)
    sc = ix["bm"].scores(q)
    fs, ss = set(factors or []), set(sectors or [])
    ranked = []
    for i, s in enumerate(sc):
        if s <= 0:
            continue
        r = ix["rows"][i]
        if r["kind"] not in kinds or (r["stale"] and not allow_stale):
            continue
        rf, rs = set(db.unj(r["factors_json"], [])), set(db.unj(r["sectors_json"], []))
        s *= 1.25 if r["kind"] == "thesis" else (1.1 if r["kind"] == "forecast" else 1.0)
        s *= 0.6 if r["stale"] else 1.0
        if fs & rf or ss & rs:
            s *= 1.3
        ranked.append((s, r, rf, rs))
    ranked.sort(key=lambda x: -x[0])
    out, per_doc = [], {}
    for s, r, rf, rs in ranked:
        if per_doc.get(r["doc_id"], 0) >= 4:  # не больше 4 фрагментов из одного документа
            continue
        per_doc[r["doc_id"]] = per_doc.get(r["doc_id"], 0) + 1
        out.append({"id": r["id"], "doc_id": r["doc_id"], "doc_title": r["doc_title"], "doc_date": r["doc_date"],
                    "kind": r["kind"], "page": r["page"], "text": r["text"][:700], "quote": r["quote"],
                    "quote_verified": None if r["quote_verified"] is None else bool(r["quote_verified"]),
                    "factors": sorted(rf), "sectors": sorted(rs), "stance": r["stance"], "horizon": r["horizon"],
                    "stale": bool(r["stale"]), "score": round(s, 2), "url": f"/api/kb/pdf/{r['doc_id']}#page={r['page'] or 1}"})
        if len(out) >= k:
            break
    return out


def bank_refs_for(factors: list[str], sectors: list[str], query: str, k: int = 2) -> list[dict]:
    """Ссылки на аналитику банка для карточки ленты.

    Строгий фильтр: тезис про тот же фактор или ту же отрасль и не из устаревшего материала,
    иначе к новости про пшеницу подставлялся обзор золота."""
    fs, ss = set(factors), set(sectors)
    res = search_kb(query, k=12, factors=factors, sectors=sectors, kinds=("thesis",), allow_stale=False)
    return [r for r in res if (fs & set(r["factors"]) or ss & set(r["sectors"])) and r["score"] >= 3][:k]
