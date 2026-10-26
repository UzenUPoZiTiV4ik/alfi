"""метрики: качество ленты и разборов, расходы, безопасность, обратная связь.

всё считается из таблиц в sqlite, отдельная инфраструктура не нужна.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import db, llm, ranking


def _since(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def content() -> dict:
    s = _since(5)
    a = db.q1("""SELECT COUNT(*) n, COUNT(DISTINCT source) src, COUNT(DISTINCT cluster_id) ev,
                        SUM(CASE WHEN extract_json IS NOT NULL THEN 1 ELSE 0 END) ext,
                        SUM(CASE WHEN origin='exa' THEN 1 ELSE 0 END) exa, SUM(CASE WHEN origin='rss' THEN 1 ELSE 0 END) rss,
                        SUM(CASE WHEN tags_json LIKE '%"business":true%' THEN 1 ELSE 0 END) biz
                 FROM news WHERE published >= ?""", (s,))
    n = a["n"] or 1
    last = db.q1("SELECT * FROM ingest_log ORDER BY id DESC LIMIT 1")
    return {"news_5d": a["n"], "sources": a["src"], "events": a["ev"], "dedup_ratio": round(1 - (a["ev"] or 0) / n, 3),
            "business_share": round((a["biz"] or 0) / n, 3), "extracted": a["ext"], "rss": a["rss"], "exa": a["exa"],
            "last_ingest": last["finished"] if last else None,
            "kb": db.q1("""SELECT COUNT(DISTINCT doc_id) docs, SUM(kind='thesis') theses, SUM(kind='forecast') forecasts,
                                  SUM(kind='thesis' AND quote_verified=1) verified FROM kb_chunks""")}


def personalization(sample: list[str] | None = None) -> dict:
    """Насколько ленты разных клиентов различаются (1 - средний Jaccard топ-10)."""
    sample = sample or ["U_34911", "U_57706", "U_9250", "U_1465", "U_3263"]
    tops = {}
    for u in sample:
        try:
            tops[u] = {it["id"] for it in ranking.feed(u, "cfo", limit=10, triage_on=False)["items"]}
        except KeyError:
            continue
    us = list(tops)
    pairs = [(a, b) for i, a in enumerate(us) for b in us[i + 1:]]
    jac = [len(tops[a] & tops[b]) / max(1, len(tops[a] | tops[b])) for a, b in pairs]
    fb = db.q1("""SELECT SUM(kind='useful') useful, SUM(kind='not_relevant') nope, SUM(kind='expert') expert,
                         AVG(CASE WHEN kind='rating' THEN value END) rating, COUNT(*) n FROM feedback""")
    return {"feed_diversity": round(1 - sum(jac) / len(jac), 3) if jac else None, "sample": us,
            "feedback": fb, "useful_rate": round((fb["useful"] or 0) / max(1, (fb["useful"] or 0) + (fb["nope"] or 0)), 3)}


def ai_quality() -> dict:
    rows = db.q("SELECT result_json, confidence FROM insights")
    n = len(rows)
    rules_ok = rules_n = 0
    crit = {"grounding": [], "personalization": [], "depth": [], "attribution": []}
    revise = repaired = bank_cov = 0
    for r in rows:
        res = db.unj(r["result_json"], {}) or {}
        for x in res.get("rules") or []:
            rules_ok += int(bool(x.get("ok")))
            rules_n += 1
        c = res.get("critic") or {}
        for k in crit:
            v = (c.get("scores") or {}).get(k)
            if isinstance(v, (int, float)):
                crit[k].append(v)
        revise += int(c.get("verdict") == "revise")
        bank_cov += int(bool((res.get("bank_view") or {}).get("points")))
    steps = db.q1("SELECT SUM(type='repair') rep, COUNT(DISTINCT run_id) runs FROM run_steps WHERE run_id IN (SELECT id FROM runs WHERE kind='insight')")
    runs = db.q1("""SELECT COUNT(*) n, SUM(status='ok') ok, SUM(status='error') err, AVG(CASE WHEN status='ok' THEN cost_rub END) cost,
                           AVG(CASE WHEN status='ok' THEN (julianday(finished)-julianday(started))*86400 END) sec FROM runs WHERE kind='insight'""")
    calls = db.q1("SELECT COUNT(*) n, SUM(ok) ok FROM llm_calls")
    return {"insights": n, "avg_confidence": round(sum(r["confidence"] or 0 for r in rows) / n, 3) if n else None,
            "rules_pass_rate": round(rules_ok / rules_n, 3) if rules_n else None,
            "critic": {k: round(sum(v) / len(v), 3) if v else None for k, v in crit.items()},
            "critic_revise_rate": round(revise / n, 3) if n else None, "bank_view_coverage": round(bank_cov / n, 3) if n else None,
            "repair_runs": steps["rep"] or 0, "runs": runs, "avg_run_cost_rub": round(runs["cost"] or 0, 3), "avg_run_seconds": round(runs["sec"] or 0, 1),
            "llm_success_rate": round((calls["ok"] or 0) / max(1, calls["n"] or 0), 3)}


def cost() -> dict:
    by = db.q("""SELECT purpose, model, COUNT(*) calls, ROUND(SUM(cost_rub),3) rub, SUM(prompt_tokens) pin, SUM(completion_tokens) pout,
                        ROUND(AVG(ms)) ms FROM llm_calls WHERE day=? GROUP BY purpose, model ORDER BY rub DESC""", (llm.today(),))
    total = db.q1("SELECT ROUND(SUM(cost_rub),3) rub, COUNT(*) n FROM llm_calls")
    return {"today": llm.budget_state(), "by_purpose_today": by, "all_time": total}


def security() -> dict:
    ev = db.q("SELECT kind, COUNT(*) n FROM security_events GROUP BY kind")
    tools = db.q1("SELECT COUNT(*) n, SUM(ok=0) failed, SUM(error LIKE 'роль%') denied FROM tool_audit")
    guards = db.q("SELECT json_extract(data_json,'$.kind') kind, COUNT(*) n FROM run_steps WHERE type='guard' GROUP BY 1")
    return {"events": ev, "tool_calls": tools, "guards": guards}


def all_metrics() -> dict:
    return {"content": content(), "personalization": personalization(), "ai": ai_quality(), "cost": cost(), "security": security(),
            "generated": datetime.now(timezone.utc).isoformat()}
