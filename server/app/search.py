"""Поиск по новостям и базе знаний: BM25 по стемам с бустами.

Индексы строятся лениво в памяти и сбрасываются после сбора новостей (invalidate).
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone

from . import db, kb, nlp, security
from .taxonomy import FACTORS, SECTORS

_lock = threading.Lock()
_generation = 0
_kb: dict | None = None


def invalidate() -> None:
    global _kb, _generation
    with _lock:
        _generation += 1
        _kb = None


def generation() -> tuple:
    with _lock:
        return (_generation, db.kb_revision())


def _kb_index() -> dict:
    global _kb
    kb.ensure_loaded()
    with _lock:
        revision = db.kb_revision()
        if _kb is None or _kb["revision"] != revision:
            rows = db.q("""SELECT c.id, c.doc_id, c.kind, c.page, c.text, c.quote, c.quote_verified, c.factors_json, c.sectors_json,
                                  c.stance, c.horizon, d.title doc_title, d.date doc_date, d.stale, d.meta_json
                           FROM kb_chunks c JOIN kb_docs d ON d.id=c.doc_id""")
            docs = [nlp.stems(f"{r['text']} {r['quote'] or ''} {r['doc_title']}") for r in rows]
            _kb = {"revision": revision, "rows": rows, "bm": nlp.BM25(docs)}
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
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat() if days else ""
    visible, args = db.news_visibility_clause(uid)
    rows = db.q(f"""SELECT id,url,title,text,source,published,cluster_id,user_uid FROM news
                    WHERE {visible} AND COALESCE(published,'') >= ? ORDER BY published DESC""", (*args, since))
    docs = [nlp.stems(row["title"]) * 3 + nlp.stems((row["text"] or "")[:1500]) for row in rows]
    bm = nlp.BM25(docs)
    excluded = exclude or set()
    seen = set()
    out = []
    for i, s in bm.top(nlp.stems(query), len(rows)):
        r = rows[i]
        cluster = (r["user_uid"] or "", r["cluster_id"] or r["id"])
        if cluster in seen or r["id"] in excluded or r["cluster_id"] in excluded:
            continue
        seen.add(cluster)
        out.append({"id": f"news:{r['id']}", "news_id": r["id"], "url": r["url"], "title": r["title"], "source": r["source"],
                    "published": r["published"], "text": (r["text"] or "")[:600], "score": round(s, 2)})
        if len(out) >= k:
            break
    return out


def search_kb(query: str, k: int = 8, factors: list[str] | None = None, sectors: list[str] | None = None,
              kinds: tuple[str, ...] = ("thesis", "forecast", "para"), allow_stale: bool = True, session: dict | None = None) -> list[dict]:
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
        if not security.can_access_kb_doc(session, r):
            continue
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


def bank_refs_for(factors: list[str], sectors: list[str], query: str, session: dict, k: int = 2) -> list[dict]:
    """Ссылки на аналитику банка для карточки ленты.

    Строгий фильтр: тезис про тот же фактор или ту же отрасль и не из устаревшего материала,
    иначе к новости про пшеницу подставлялся обзор золота."""
    fs, ss = set(factors), set(sectors)
    res = search_kb(query, k=12, factors=factors, sectors=sectors, kinds=("thesis",), allow_stale=False, session=session)
    return [r for r in res if (fs & set(r["factors"]) or ss & set(r["sectors"])) and r["score"] >= 3][:k]
