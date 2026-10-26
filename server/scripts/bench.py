"""замер: агент против одного вызова модели, с размышлениями и без.

для каждой новости гоняем пять вариантов:
  ours        полный агент (план, инструменты, проверки, критик, доработка)
  ours_think  то же, но с включёнными размышлениями
  rag         один вызов, но ему дают ту же аналитику банка, что нашёл агент
  rag_think   то же с размышлениями
  bare        один вызов без источников, только новость и профиль

качество считаем одинаково: 9 правил verify + независимый критик, как в проде.

запуск: uv run python -m scripts.bench [--news 3] [--out ../docs/bench/results.json]
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from app import agent, config, db, llm, profile, ranking, security, tools
from app.taxonomy import FACTORS

UID, ROLE = "U_34911", "cfo"

SCHEMA = """Ответь строго JSON:
{"headline":"что меняется для компании, до 90 символов",
 "what_happened":{"text":"1-2 предложения","refs":["id"]},
 "why_it_matters":{"text":"1-2 предложения через признаки компании","refs":["id"]},
 "impact_channels":[{"channel":"","effect":"","refs":["id"]}],
 "affected_areas":[{"id":"revenue|costs|debt|liquidity|fx|tax|supply|customers|counterparty|people|compliance|strategy","impact":"positive|negative|mixed","text":"","refs":["id"]}],
 "risks":[{"title":"","text":"","refs":["id"]}],
 "opportunities":[{"title":"","text":"","refs":["id"]}],
 "bank_view":{"summary":"позиция Альфа-Банка","refs":["bank:..."]},
 "actions":[{"title":"","text":"","refs":["id"]}],
 "confidence":0.0}
Ссылайся только на id из источников. Позиция банка только из bank:*, если таких нет — пустая строка."""


class FakeRun:
    """критику нужен объект с id и emit, полноценный Run тут не нужен."""

    def __init__(self, tag: str):
        self.id = f"bench-{tag}-{int(time.time() * 1000) % 10**9}"

    def emit(self, *a, **k):
        pass


def pool_for(news_id: str, with_bank: bool = True):
    """всё, до чего агент может дотянуться: проверки правил не должны падать из-за пустого пула"""
    p = profile.build(UID)
    pool = agent.Pool()
    pool.add(agent.feat_items(p))
    ctx = {"uid": UID, "role": ROLE, "run_id": "bench", "web_calls": 0, "web_limit": 0, "exclude_news": set()}
    base = tools.call("get_news", {"id": news_id}, ctx)
    pool.add(base["items"])
    for tool, args in (("get_counterparties", {"side": "customers"}), ("get_group_structure", {}), ("get_linked_companies", {})):
        try:
            pool.add(tools.call(tool, args, ctx)["items"])
        except Exception:  # noqa: BLE001
            pass
    if with_bank:
        sc = ranking.reasons_for(UID, ROLE, news_id) or {"factors": []}
        q = " ".join(FACTORS[f]["label"] for f in sc["factors"][:3])
        try:
            pool.add(tools.call("search_bank_analytics", {"query": q, "factors": sc["factors"][:3]}, ctx)["items"])
        except tools.ToolError:
            pass
    return p, pool, base["items"][0]


def digest(pool: agent.Pool, main: dict, with_bank: bool) -> str:
    rows = [f"[{main['id']}] {main['title']}\n{main.get('text', '')[:2500]}"]
    if with_bank:
        for i, it in pool.items.items():
            if it["kind"] == "bank":
                rows.append(f"[{i}] {it.get('title', '')}\n{(it.get('text') or '')[:700]}")
            elif it["kind"] == "feat":
                rows.append(f"[{i}] {it.get('title', '')}: {(it.get('text') or '')[:200]}")
    return "\n\n".join(rows[:24])


def one_call(news_id: str, with_bank: bool, think: bool, tag: str) -> dict:
    p, pool, main = pool_for(news_id, with_bank)
    rl = agent.ROLES[ROLE]
    run = FakeRun(tag)
    t0 = time.time()
    sys_p = (f"Ты старший аналитик Альфа-Банка. Разбор события для роли {rl['label']} (фокус: {rl['focus']}). "
             f"Сегодня {datetime.now():%Y-%m-%d}. Пиши по-русски, без пересказа новости. {SCHEMA}")
    user = f"КОМПАНИЯ:\n{profile.brief(p, 8)}\n\nИСТОЧНИКИ:\n{security.wrap_untrusted(digest(pool, main, with_bank))}"
    cost = 0.0
    try:
        r, cr = llm.chat_json([{"role": "system", "content": sys_p}, {"role": "user", "content": user}],
                              role="agent", purpose=f"bench_{tag}", run_id=run.id, max_tokens=2600,
                              temperature=0.25, timeout=180, reasoning=think)
        cost += cr["cost"]
        res = agent.normalize(r if isinstance(r, dict) else {})
    except Exception as e:  # noqa: BLE001
        return {"tag": tag, "ok": False, "error": f"{type(e).__name__}: {e}"[:200], "sec": round(time.time() - t0, 1), "cost": 0}
    res = agent.normalize(res)
    rules = agent.verify(res, pool, main.get("text", ""))
    crit = agent.critique(res, pool, run)
    cost += (crit or {}).get("cost", 0)
    return pack(tag, res, rules, crit, cost, time.time() - t0)


def pack(tag, res, rules, crit, cost, sec) -> dict:
    scores = (crit or {}).get("scores", {})
    return {
        "tag": tag, "ok": True, "sec": round(sec, 1), "cost": round(cost, 3),
        "rules_passed": sum(1 for r in rules if r["ok"]), "rules_total": len(rules),
        "failed": [r["id"] for r in rules if not r["ok"]],
        "critic": scores, "critic_avg": round(sum(scores.values()) / len(scores), 3) if scores else None,
        "has_bank": bool((res.get("bank_view") or {}).get("summary")),
        "refs": len(agent.referenced(res)), "words": len(json.dumps(res, ensure_ascii=False).split()),
        "headline": res.get("headline", "")[:120],
    }


def ours(news_id: str, think: bool, tag: str) -> dict:
    old = config.LLM_REASONING
    config.LLM_REASONING = think
    t0 = time.time()
    try:
        run = agent.Run("insight", UID, ROLE, news_id)
        agent.run_insight(run, force=True)
        row = db.q1("SELECT status FROM runs WHERE id=?", (run.id,))
        c = agent.cached(UID, ROLE, news_id)
        if row["status"] != "ok" or not c:
            return {"tag": tag, "ok": False, "error": row["status"], "sec": round(time.time() - t0, 1), "cost": run.cost()}
        res = agent.normalize(c)
        _, pool, main = pool_for(news_id)
        # добавляем всё, что агент реально видел: web, другие новости, данные
        pool.add([{**v, "id": k} for k, v in (c.get("sources") or {}).items()])
        rules = agent.verify(res, pool, main.get("text", ""))
        return pack(tag, res, rules, c.get("critic"), run.cost(), time.time() - t0)
    finally:
        config.LLM_REASONING = old


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--news", type=int, default=3)
    ap.add_argument("--out", default="../docs/bench/results.json")
    a = ap.parse_args()

    db.init()
    feed = ranking.feed(UID, ROLE, triage_on=False)
    ids = [it["id"] for it in feed["items"] if not it.get("user")][: a.news]
    print(f"новостей: {len(ids)}, бюджет на сегодня: {llm.spent_today():.2f} ₽", flush=True)

    out = {"meta": {"uid": UID, "role": ROLE, "at": datetime.now().isoformat(timespec="seconds"),
                    "model": config.MODELS["agent"], "critic": config.MODELS["critic"], "news": ids}, "rows": []}
    variants = [("ours", lambda i: ours(i, False, "ours")),
                ("ours_think", lambda i: ours(i, True, "ours_think")),
                ("rag", lambda i: one_call(i, True, False, "rag")),
                ("rag_think", lambda i: one_call(i, True, True, "rag_think")),
                ("bare", lambda i: one_call(i, False, False, "bare"))]
    for nid in ids:
        for name, fn in variants:
            try:
                r = fn(nid)
            except Exception as e:  # noqa: BLE001 один сбой не должен рушить весь замер
                r = {"ok": False, "error": f"{type(e).__name__}: {e}"[:200], "sec": 0, "cost": 0}
            r.update({"news": nid, "variant": name})
            out["rows"].append(r)
            state = "ok" if r.get("ok") else "fail"
            print(f"{name:11} {nid[:8]} {state} rules={r.get('rules_passed')}/{r.get('rules_total')} "
                  f"критик={r.get('critic_avg')} банк={r.get('has_bank')} {r.get('sec')}с {r.get('cost')}₽", flush=True)
            Path(a.out).parent.mkdir(parents=True, exist_ok=True)
            Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=2))

    # сводка
    ok = [r for r in out["rows"] if r.get("ok")]
    print("\nвариант        правила   критик   банк   ссылки   сек   ₽")
    for name, _ in variants:
        v = [r for r in ok if r["variant"] == name]
        if not v:
            print(f"{name:14} нет данных")
            continue
        print(f"{name:14} {sum(r['rules_passed'] for r in v) / sum(r['rules_total'] for r in v) * 100:5.0f}%   "
              f"{sum(r['critic_avg'] or 0 for r in v) / len(v):.3f}   "
              f"{sum(r['has_bank'] for r in v)}/{len(v)}   "
              f"{sum(r['refs'] for r in v) / len(v):5.1f}   "
              f"{sum(r['sec'] for r in v) / len(v):4.0f}   {sum(r['cost'] for r in v) / len(v):.2f}")


if __name__ == "__main__":
    main()
