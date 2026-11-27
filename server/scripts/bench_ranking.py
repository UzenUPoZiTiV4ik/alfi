"""Бенчмарк качества ранжирования ленты: сравнение формулы отборочного этапа (ДО) и финальной калиброванной (ПОСЛЕ).

Считает стандартные метрики рекомендательных систем на 80 размеченных парах (5 компаний × 16 новостей):
  NDCG@5, NDCG@10, Precision@5 (rel>=2), Noise@5 (rel==0), MRR (первое событие rel==3),
  Hit Rate@3, Feed Diversity (1 - средний Jaccard топ-5 между компаниями).

Запуск: cd server && .venv/bin/python -m scripts.bench_ranking --out ../docs/bench/ranking.json
"""
from __future__ import annotations

import argparse
import json
import math
import os
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("ALFI_DEMO_MODE", "1")
os.environ.setdefault("LLM_API_KEY", "")

from app import config, db, news, profile, ranking
from app.taxonomy import ROLES, SOURCE_TRUST
from scripts.bench_cases import RANKING_COMPANIES, RANKING_LABELS, RANKING_NEWS


def legacy_score(n: dict, p: dict, role: str, now_dt: datetime) -> float:
    """Точная копия формулы ранжирования из версии отборочного этапа (до финальных правок)."""
    secs, facs, ext = ranking._news_signals(n)
    if ext and ext.get("business") is False:
        return 0.0
    boost = ROLES.get(role, ROLES["cfo"])["boost"]
    sector = 0.0
    for s, hits in secs.items():
        v = p["sector_weights"].get(s, 0) * min(1.0, 0.45 + 0.2 * hits)
        if v > sector:
            sector = v
    contrib = {}
    for f, hits in facs.items():
        sens = p["sensitivities"].get(f)
        if not sens:
            continue
        strength = min(1.0, 0.3 + 0.18 * hits)
        contrib[f] = strength * sens["value"] * boost.get(f, 1.0)
    factor = 1 - math.exp(-1.3 * sum(contrib.values()))
    geo = 0.0
    if p["region_stem"] and p["region_stem"] in (n["tags"].get("regions") or []):
        geo += 0.25
    hit_c = [c for c in p["countries"] if c in (n["tags"].get("countries") or [])]
    if hit_c and (set(contrib) & {"trade", "fx", "logistics"} or sector >= 0.6):
        geo += 0.35
    base = 0.55 * sector + 0.75 * factor + geo
    mat = int(ext.get("materiality") or 2)
    materiality = 0.55 + 0.15 * min(5, mat)
    age_h = max(0.0, (now_dt - datetime.fromisoformat(n["published"])).total_seconds() / 3600)
    recency = 0.5 + 0.5 * math.exp(-age_h / 72)
    trust = 0.75 + 0.25 * SOURCE_TRUST.get(n["source_id"] or "exa", 0.6)
    cluster = 1.0
    return base * materiality * recency * trust * cluster


def dcg(rels: list[int], k: int) -> float:
    return sum((2 ** r - 1) / math.log2(i + 2) for i, r in enumerate(rels[:k]))


def ndcg(ranked_ids: list[str], labels: dict[str, int], k: int) -> float:
    rels = [labels.get(i, 0) for i in ranked_ids[:k]]
    ideal = sorted(labels.values(), reverse=True)
    idcg = dcg(ideal, k)
    return (dcg(rels, k) / idcg) if idcg > 0 else 0.0


def evaluate_system(mode: str, prepared_news: list[dict], now_dt: datetime, role: str = "cfo") -> dict:
    per_company = {}
    tops: dict[str, set[str]] = {}
    for c in RANKING_COMPANIES:
        uid = c["uid"]
        p = profile.build(uid)
        labels = RANKING_LABELS[uid]
        scored = []
        for n in prepared_news:
            if mode == "before":
                sc = legacy_score(n, p, role, now_dt)
            else:
                res = ranking.score(n, p, role, {})
                sc = res["score"] if res else 0.0
            scored.append((sc, n["id"]))
        scored.sort(key=lambda x: -x[0])
        # В реальную ленту попадают только события выше порога FEED_THRESHOLD (0.16)
        feed_scored = [(sc, nid) for sc, nid in scored if sc >= config.FEED_THRESHOLD]
        ranked_ids = [nid for _, nid in feed_scored]
        top5 = ranked_ids[:5]
        tops[uid] = set(top5)
        rel5 = [labels.get(i, 0) for i in top5]
        rel_all = [labels.get(i, 0) for i in ranked_ids]
        mrr = 0.0
        for idx, nid in enumerate(ranked_ids, 1):
            if labels.get(nid, 0) >= 3:
                mrr = 1.0 / idx
                break
        denom5 = max(1, len(top5))
        per_company[uid] = {
            "sector": c["sector"],
            "feed_size": len(ranked_ids),
            "ndcg_5": round(ndcg(ranked_ids, labels, 5), 4),
            "ndcg_10": round(ndcg(ranked_ids, labels, 10), 4),
            "precision_5": round(sum(1 for r in rel5 if r >= 2) / denom5, 4),
            "noise_5": round(sum(1 for r in rel5 if r == 0) / denom5, 4),
            "feed_noise": round(sum(1 for r in rel_all if r == 0) / max(1, len(rel_all)), 4),
            "hit_rate_3": round(1.0 if any(labels.get(i, 0) >= 3 for i in ranked_ids[:3]) else 0.0, 4),
            "mrr": round(mrr, 4),
            "top5": [{"id": nid, "label": labels.get(nid, 0), "score": round(sc, 3)} for sc, nid in feed_scored[:5]],
        }
    uids = list(tops)
    pairs = [(a, b) for i, a in enumerate(uids) for b in uids[i + 1:]]
    jacs = [len(tops[a] & tops[b]) / max(1, len(tops[a] | tops[b])) for a, b in pairs]
    n = len(per_company)
    return {
        "ndcg_5": round(sum(v["ndcg_5"] for v in per_company.values()) / n, 4),
        "ndcg_10": round(sum(v["ndcg_10"] for v in per_company.values()) / n, 4),
        "precision_5": round(sum(v["precision_5"] for v in per_company.values()) / n, 4),
        "noise_5": round(sum(v["noise_5"] for v in per_company.values()) / n, 4),
        "feed_noise": round(sum(v["feed_noise"] for v in per_company.values()) / n, 4),
        "avg_feed_size": round(sum(v["feed_size"] for v in per_company.values()) / n, 2),
        "hit_rate_3": round(sum(v["hit_rate_3"] for v in per_company.values()) / n, 4),
        "mrr": round(sum(v["mrr"] for v in per_company.values()) / n, 4),
        "diversity_5": round(1 - sum(jacs) / len(jacs), 4) if jacs else 0.0,
        "per_company": per_company,
    }


def run_ranking_benchmark() -> dict:
    now_dt = datetime(2026, 10, 26, 20, 30, tzinfo=timezone.utc)
    orig_db = config.DB_PATH
    orig_local = db._local
    orig_rnow = ranking.now
    orig_nnow = news.now
    with tempfile.TemporaryDirectory() as tmp:
        config.DB_PATH = Path(tmp) / "rank_bench.db"
        db._local = threading.local()
        ranking.now = lambda: now_dt
        news.now = lambda: now_dt
        try:
            db.init()
            profile.invalidate_cache()
            for c in RANKING_COMPANIES:
                db.ex(
                    """INSERT INTO companies(uid,sector,okved,okved_name,revenue,region,city,loa,lea,dep,gar,fts,fts_country,workers_fns,cl_type,rko)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (c["uid"], c["sector"], c["okved"], c["okved_name"], c["revenue"], c["region"], c["city"],
                     c.get("loa", 0), c.get("lea", 0), c.get("dep", 0), c.get("gar", 0), c.get("fts", 0),
                     c.get("fts_country"), c.get("workers_fns"), "CLIENT", 1.0),
                )
            prepared = []
            for item in RANKING_NEWS:
                pub = (now_dt - timedelta(hours=item["age_h"])).isoformat()
                tags = news.rule_tags(item["title"], item["text"])
                prepared.append({
                    **item,
                    "published": pub,
                    "tags": tags,
                    "n_sources": 1,
                    "user_uid": None,
                })
            before = evaluate_system("before", prepared, now_dt)
            after = evaluate_system("after", prepared, now_dt)
            return {
                "meta": {
                    "companies": len(RANKING_COMPANIES),
                    "news_per_company": len(RANKING_NEWS),
                    "total_pairs": len(RANKING_COMPANIES) * len(RANKING_NEWS),
                    "role": "cfo",
                    "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                },
                "before": before,
                "after": after,
                "delta": {
                    k: round(after[k] - before[k], 4)
                    for k in ("ndcg_5", "ndcg_10", "precision_5", "noise_5", "feed_noise", "hit_rate_3", "mrr", "diversity_5")
                },
            }
        finally:
            try:
                db.conn().close()
            except Exception:
                pass
            config.DB_PATH = orig_db
            db._local = orig_local
            ranking.now = orig_rnow
            news.now = orig_nnow
            profile.invalidate_cache()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="../docs/bench/ranking.json")
    args = ap.parse_args()
    res = run_ranking_benchmark()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    b, a, d = res["before"], res["after"], res["delta"]
    print(f"Ранжирование ({res['meta']['total_pairs']} пар, 5 компаний × 16 новостей):")
    print(f"  метрика        ДО (отбор)   ПОСЛЕ (финал)   разница")
    for k, label in (("ndcg_5", "NDCG@5"), ("ndcg_10", "NDCG@10"), ("precision_5", "Precision@5"),
                     ("noise_5", "Noise@5 (↓)"), ("feed_noise", "FeedNoise (↓)"), ("hit_rate_3", "HitRate@3"),
                     ("mrr", "MRR"), ("diversity_5", "Diversity@5")):
        print(f"  {label:14s} {b[k]:10.3f}   {a[k]:13.3f}   {d[k]:+.3f}")


if __name__ == "__main__":
    main()
