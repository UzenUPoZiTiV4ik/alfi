"""аналитика альфа-банка: документы и фрагменты из data/kb/kb.json.

id фрагментов: bank:<doc>:t1 тезис, :f1 прогноз, :p12-3 абзац.
"""
from __future__ import annotations

import json
import re

from . import config, db

DOC_SLUGS = {
    "ALFA-7M26.pdf": "macro-7m26",
    "ALFA-Macro_Insights-Policy_Rate_11Sep.pdf": "rate-11sep",
    "ALFA-consumption.pdf": "consumption",
    "ALFA-macro_stat1H26.pdf": "macro-1h26",
    "ALFA_Russian_Steels_1К21PreviewUpdate_15Apr2021.pdf": "steel-1q21",
    "FI_Strategy_3Q26_22072026.pdf": "fi-3q26",
    "Gold_digest_August26.pdf": "gold-aug26",
    "Inflation_tracker_02.pdf": "infl-sep",
    "Бонд_Бриф_14092026.pdf": "bond-14sep",
}

def slug(file: str) -> str:
    return DOC_SLUGS.get(file) or re.sub(r"[^a-z0-9]+", "-", file.lower().rsplit(".", 1)[0]).strip("-")[:24]

def paragraphs(text: str, size: int = 700) -> list[str]:
    """Режем OCR-страницу на куски ~size символов по границам строк."""
    out, cur = [], ""
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        if len(cur) + len(line) > size and len(cur) > size * 0.4:
            out.append(cur.strip())
            cur = ""
        cur += line + (" " if not line.endswith("-") else "")
    if len(cur.strip()) > 60:
        out.append(cur.strip())
    return out

def load_json() -> int:
    """kb.json -> таблицы kb_docs / kb_chunks. Возвращает число фрагментов."""
    path = config.KB_DIR / "kb.json"
    if not path.exists():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    db.ex("DELETE FROM kb_docs")
    db.ex("DELETE FROM kb_chunks")
    rows = []
    for d in data["docs"]:
        db.ex("INSERT INTO kb_docs(id,file,title,date,kind,pages,summary,stale,meta_json) VALUES(?,?,?,?,?,?,?,?,?)",
              (d["id"], d["file"], d["title"], d.get("date"), d.get("kind"), d.get("pages"), d.get("summary"),
               int(d.get("stale", False)), db.j(d.get("meta", {}))))
        for ch in d["chunks"]:
            rows.append((ch["id"], d["id"], ch["kind"], ch.get("page"), ch["text"], ch.get("quote"),
                         None if ch.get("quote_verified") is None else int(ch["quote_verified"]),
                         db.j(ch.get("factors", [])), db.j(ch.get("sectors", [])), ch.get("stance"), ch.get("horizon"),
                         db.j(ch.get("meta", {}))))
    db.exmany("INSERT INTO kb_chunks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    return len(rows)

def ensure_loaded() -> None:
    if db.q1("SELECT COUNT(*) n FROM kb_chunks")["n"] == 0:
        load_json()

def docs() -> list[dict]:
    out = db.q("""SELECT d.*, (SELECT COUNT(*) FROM kb_chunks c WHERE c.doc_id=d.id AND c.kind='thesis') theses,
                         (SELECT COUNT(*) FROM kb_chunks c WHERE c.doc_id=d.id AND c.kind='forecast') forecasts,
                         (SELECT COUNT(*) FROM kb_chunks c WHERE c.doc_id=d.id AND c.kind='thesis' AND c.quote_verified=1) verified
                  FROM kb_docs d ORDER BY d.date DESC""")
    for d in out:
        d["stale"] = bool(d["stale"])
        d["meta"] = db.unj(d.pop("meta_json"), {})
    return out

def doc(doc_id: str) -> dict | None:
    d = db.q1("SELECT * FROM kb_docs WHERE id=?", (doc_id,))
    if not d:
        return None
    d["stale"] = bool(d["stale"])
    d["meta"] = db.unj(d.pop("meta_json"), {})
    d["chunks"] = [chunk_view(c) for c in db.q("SELECT * FROM kb_chunks WHERE doc_id=? AND kind!='para' ORDER BY kind DESC, id", (doc_id,))]
    return d

def chunk(cid: str) -> dict | None:
    c = db.q1("SELECT c.*, d.title doc_title, d.date doc_date, d.stale FROM kb_chunks c JOIN kb_docs d ON d.id=c.doc_id WHERE c.id=?", (cid,))
    return chunk_view(c) if c else None

def chunk_view(c: dict) -> dict:
    c = dict(c)
    c["factors"] = db.unj(c.pop("factors_json", None), [])
    c["sectors"] = db.unj(c.pop("sectors_json", None), [])
    c["meta"] = db.unj(c.pop("meta_json", None), {})
    if "stale" in c:
        c["stale"] = bool(c["stale"])
    if c.get("quote_verified") is not None:
        c["quote_verified"] = bool(c["quote_verified"])
    c["url"] = f"/api/kb/pdf/{c['doc_id']}#page={c.get('page') or 1}"
    return c
