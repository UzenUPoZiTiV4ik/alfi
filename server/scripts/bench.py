"""End-to-End бенчмарк Альфи: модели в роли агента, режимы мышления и абляция архитектуры.

Работает на чистой изолированной временной БД (5 разноотраслевых компаний + 5 событий +
реальная база знаний Альфа-Банка server/data/kb/kb.json), без зависимости от локальной alfi.db
и без внешней нестабильности Exa.

Три блока сравнения:
  1. models    — 5 моделей шлюза в роли полного агента (с cross-family критиком)
  2. reasoning — режимы мышления на лучшей модели: off, selective (critic+repair),
                 selective_synth (synth+critic+repair), on (везде)
  3. ablation  — полный агент против одного вызова с аналитикой банка (single_rag)
                 и одного вызова без источников (single_bare)

Метрики: 10–11 правил verify, 6 осей независимого критика (grounding, personalization,
depth, attribution, source_fidelity, no_overclaim), доля ready/needs_review, ссылки,
латентность, стоимость в ₽ и пропускная способность в суточном бюджете 600 ₽.

Запуск:
  cd server && LLM_API_KEY=... .venv/bin/python -m scripts.bench --out ../docs/bench/results.json
"""
from __future__ import annotations

import argparse
import json
import os
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

os.environ.setdefault("ALFI_DEMO_MODE", "1")

from app import agent, config, db, kb, llm, news, profile, ranking, security, tools
from app.taxonomy import FACTORS

# =============================================================================
# Чистый воспроизводимый E2E-корпус: 5 отраслей × 5 событий + доп. новости с URL
# =============================================================================
E2E_COMPANIES: list[dict] = [
    {
        "uid": "E2E_AGRO", "sector": "agro", "okved": "46.21",
        "okved_name": "Торговля оптовая зерном, необработанным табаком, семенами и кормами",
        "revenue": 53.9e9, "region": "Ростовская область", "city": "Ростов-на-Дону",
        "loa": 1.0, "dep": 1.0, "gar": 1.0, "fts": 1.0, "fts_country": "ОАЭ, АЛЖИР, ИНДИЯ", "workers_fns": "Более 251",
    },
    {
        "uid": "E2E_BEV", "sector": "beverages", "okved": "46.34",
        "okved_name": "Торговля оптовая напитками",
        "revenue": 44.4e9, "region": "г. Москва", "city": "Москва",
        "loa": 1.0, "dep": 1.0, "gar": 0.0, "fts": 1.0, "fts_country": "ГРУЗИЯ, АЗЕРБАЙДЖАН", "workers_fns": "Более 251",
    },
    {
        "uid": "E2E_FUEL", "sector": "fuel", "okved": "46.71",
        "okved_name": "Торговля оптовая твердым, жидким и газообразным топливом",
        "revenue": 38.1e9, "region": "г. Москва", "city": "Москва",
        "loa": 1.0, "dep": 0.0, "gar": 1.0, "fts": 0.0, "fts_country": None, "workers_fns": "101-250",
    },
    {
        "uid": "E2E_CONST", "sector": "construction", "okved": "41.20",
        "okved_name": "Строительство жилых и нежилых зданий",
        "revenue": 25.0e9, "region": "Краснодарский край", "city": "Краснодар",
        "loa": 1.0, "dep": 0.0, "gar": 1.0, "fts": 0.0, "fts_country": None, "workers_fns": "Более 251",
    },
    {
        "uid": "E2E_DEMO", "sector": "electronics", "okved": "46.52",
        "okved_name": "Торговля оптовая электронным и телекоммуникационным оборудованием",
        "revenue": 30.0e9, "region": "г. Москва", "city": "Москва",
        "loa": 0.0, "dep": 1.0, "gar": 0.0, "fts": 1.0, "fts_country": "КИТАЙ", "workers_fns": "101-250",
    },
    # Вспомогательные юрлица для контрагентов и группы (не анализируются напрямую)
    {
        "uid": "E2E_LOG_P", "sector": "logistics", "okved": "49.41", "okved_name": "Грузовые перевозки",
        "revenue": 12.0e9, "region": "Ростовская область", "city": "Ростов-на-Дону",
        "loa": 1.0, "dep": 0.0, "gar": 0.0, "fts": 0.0, "fts_country": None, "workers_fns": "101-250",
    },
    {
        "uid": "E2E_RET_P", "sector": "retail", "okved": "47.11", "okved_name": "Торговля розничная продуктами",
        "revenue": 28.0e9, "region": "г. Москва", "city": "Москва",
        "loa": 1.0, "dep": 1.0, "gar": 0.0, "fts": 0.0, "fts_country": None, "workers_fns": "Более 251",
    },
    {
        "uid": "E2E_AZS_P", "sector": "fuel", "okved": "47.30", "okved_name": "Торговля розничная моторным топливом",
        "revenue": 15.0e9, "region": "г. Москва", "city": "Москва",
        "loa": 1.0, "dep": 0.0, "gar": 0.0, "fts": 0.0, "fts_country": None, "workers_fns": "101-250",
    },
]

E2E_EVENTS: list[dict] = [
    {
        "id": "e2e_agro_algeria",
        "uid": "E2E_AGRO",
        "role": "cfo",
        "title": "Экспорт российского зерна в Алжир вырос в 1,7 раза, но отгрузки через Чёрное море замедлились",
        "text": (
            "За 9 месяцев 2026 года общий экспорт российского зерна в Алжир вырос в 1,7 раза г/г на фоне тендеров "
            "госагентства OAIC. Одновременно в октябре отгрузки пшеницы из портов Чёрного моря и Ростовской области "
            "замедлились из-за штормов и роста ставок фрахта. Данных о долях отдельных российских экспортёров нет."
        ),
        "url": "https://interfax.ru/business/e2e-agro-algeria",
        "source": "Интерфакс",
        "source_id": "interfax",
        "extract": {"business": True, "scope": "sector", "event_type": "рынок", "sectors": ["agro", "logistics"],
                    "factors": [{"id": "agro", "strength": 3}, {"id": "trade", "strength": 3}, {"id": "logistics", "strength": 3}], "materiality": 5},
    },
    {
        "id": "e2e_bev_excise",
        "uid": "E2E_BEV",
        "role": "cfo",
        "title": "При Правительстве обсудили расширение акцизов на безалкогольные напитки на фоне охлаждения спроса",
        "text": (
            "В Аналитическом центре при Правительстве РФ обсудили возможное расширение перечня подакцизных безалкогольных "
            "напитков и корректировку налоговой нагрузки с 2027 года. Конкретные ставки акциза и финальные параметры "
            "законопроекта пока не определены. Участники рынка отмечают одновременное замедление розничного спроса."
        ),
        "url": "https://vedomosti.ru/business/e2e-bev-excise",
        "source": "Ведомости",
        "source_id": "vedomosti",
        "extract": {"business": True, "scope": "sector", "event_type": "решение регулятора", "sectors": ["beverages"],
                    "factors": [{"id": "tax", "strength": 3}, {"id": "regulation", "strength": 3}, {"id": "demand", "strength": 2}], "materiality": 5},
    },
    {
        "id": "e2e_fuel_trassa",
        "uid": "E2E_FUEL",
        "role": "cfo",
        "title": "Сеть АЗС «Трасса» потребовали признать банкротом на фоне роста биржевых цен на дизель на 3,2%",
        "text": (
            "Кредитор подал заявление о банкротстве оператора сети АЗС «Трасса» в Москве, компания оспаривает иск в суде. "
            "Параллельно оптовые цены на дизельное топливо на СПбМТСБ выросли на 3,2% за неделю из-за ремонтов на НПЗ, "
            "что усиливает давление на оборотный капитал и платёжную дисциплину розничных сетей АЗС."
        ),
        "url": "https://rbc.ru/business/e2e-fuel-trassa",
        "source": "РБК",
        "source_id": "rbc",
        "extract": {"business": True, "scope": "sector", "event_type": "инцидент", "sectors": ["fuel"],
                    "factors": [{"id": "oil", "strength": 3}, {"id": "credit", "strength": 3}], "materiality": 4},
    },
    {
        "id": "e2e_const_cbr",
        "uid": "E2E_CONST",
        "role": "cfo",
        "title": "Банк России 23 октября 2026 сохранил ключевую ставку на уровне 14,0% и обсуждает лимиты льготной ипотеки",
        "text": (
            "Совет директоров Банка России 23 октября 2026 года сохранил ключевую ставку на уровне 14,0% годовых "
            "и указал на сохранение жёстких денежно-кредитных условий. Регулятор также подтвердил курс на ограничение "
            "неадресных программ льготной ипотеки для сдерживания перегрева на рынке новостроек."
        ),
        "url": "https://cbr.ru/press/e2e-const-cbr",
        "source": "Банк России",
        "source_id": "cbr",
        "extract": {"business": True, "scope": "macro", "event_type": "решение регулятора", "sectors": ["construction"],
                    "factors": [{"id": "rate", "strength": 3}, {"id": "credit", "strength": 3}, {"id": "realty", "strength": 3}], "materiality": 5},
    },
    {
        "id": "e2e_demo_china",
        "uid": "E2E_DEMO",
        "role": "cfo",
        "title": "Китайские банки усилили комплаенс по трансграничным платежам из РФ за электронику",
        "text": (
            "Импортёры электроники и телеком-оборудования сообщают об увеличении сроков проверки прямых платежей "
            "в юанях со стороны китайских региональных банков. В результате растут транзакционные издержки и сроки "
            "поставки комплектующих."
        ),
        "url": "https://kommersant.ru/doc/e2e-demo-china",
        "source": "Коммерсантъ",
        "source_id": "kommersant",
        "extract": {"business": True, "scope": "sector", "event_type": "инцидент", "sectors": ["electronics"],
                    "factors": [{"id": "trade", "strength": 3}, {"id": "fx", "strength": 3}, {"id": "logistics", "strength": 2}], "materiality": 4},
        "clarification": "Мы рассчитываемся с поставщиками через платёжного агента в Гонконге в рублях, прямых контрактов в юанях у нас нет.",
    },
]

# Дополнительные новости-спутники в БД (чтобы search_news находил доп. ссылки и сохранял их в sources)
E2E_EXTRA_NEWS: list[dict] = [
    {
        "id": "e2e_extra_grain_q",
        "title": "Минсельхоз обсуждает параметры экспортной квоты на зерно на 2027 год",
        "text": "Участники зернового рынка ждут финального постановления по квоте на экспорт пшеницы и ставкам фрахта в Чёрном море.",
        "url": "https://tass.ru/ekonomika/e2e-grain-quota",
        "source": "ТАСС",
        "source_id": "tass",
        "extract": {"business": True, "scope": "sector", "event_type": "решение регулятора", "sectors": ["agro"],
                    "factors": [{"id": "agro", "strength": 3}, {"id": "trade", "strength": 2}], "materiality": 4},
    },
    {
        "id": "e2e_extra_diesel",
        "title": "НПЗ продлили плановые ремонты, оптовые поставки дизеля остаются напряжёнными",
        "text": "На топливном рынке сохраняется повышенный спрос на зимнее дизельное топливо и рост дебиторской нагрузки в сегменте АЗС.",
        "url": "https://kommersant.ru/doc/e2e-diesel-npz",
        "source": "Коммерсантъ",
        "source_id": "kommersant",
        "extract": {"business": True, "scope": "sector", "event_type": "цены", "sectors": ["fuel"],
                    "factors": [{"id": "oil", "strength": 3}], "materiality": 3},
    },
]

SINGLE_SCHEMA = """Ответь строго JSON:
{"headline":"до 100 символов: что меняется для компании","kind":"risk|chance|mixed",
"what_happened":{"summary":"2-3 предложения","facts":[{"text":"...","status":"confirmed|reported|unclear","sources":["news:..."]}],"participants":["..."],"timing":"...","causes":"..."},
"why_it_matters":{"text":"3-5 предложений через признаки компании","sources":["feat:...","news:..."]},
"impact_channels":[{"factor":"id","direction":"up|down|mixed","magnitude":"low|medium|high","explanation":"...","sources":["..."]}],
"affected_areas":[{"area":"id","impact":"positive|negative|mixed","effect":"...","sources":["..."]}],
"risks":[{"title":"...","text":"...","probability":"low|medium|high","horizon":"...","sources":["..."]}],
"opportunities":[{"title":"...","text":"...","conditions":"условия реализации","scope":"market|sector|company","horizon":"...","sources":["..."]}],
"bank_view":{"summary":"позиция Альфа-Банка (только из bank:*)","points":[{"text":"...","sources":["bank:..."]}],"coverage":"full|partial|none"},
"scenarios":[{"name":"базовый|негативный|позитивный","text":"...","trigger":"...","sources":["..."]}],
"actions":[{"title":"...","text":"...","owner":"...","urgency":"now|week|month|quarter","product":"","sources":["..."]}],
"questions":["..."],"data_gaps":["..."],"confidence":0.0}"""


class FakeRun:
    def __init__(self, tag: str):
        self.id = f"bench-{tag}-{int(time.time() * 1000) % 10**9}"

    def emit(self, *a, **k):
        pass


def pick_critic_for(agent_model: str) -> str:
    """Cross-family критик: никогда не оценивает сам себя."""
    if agent_model == "z-ai/glm-5.3-flash":
        return "deepseek/deepseek-v4.1-flash"
    if agent_model == "deepseek/deepseek-v4.1-flash":
        return "z-ai/glm-5.3-flash"
    return "deepseek/deepseek-v4.1-flash"


def seed_e2e_db(now_dt: datetime) -> None:
    db.init()
    kb.load_json()
    profile.invalidate_cache()
    for c in E2E_COMPANIES:
        db.ex(
            """INSERT OR REPLACE INTO companies(uid,sector,okved,okved_name,revenue,region,city,loa,lea,dep,gar,fts,fts_country,workers_fns,cl_type,rko)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (c["uid"], c["sector"], c["okved"], c["okved_name"], c["revenue"], c["region"], c["city"],
             c.get("loa", 0), c.get("lea", 0), c.get("dep", 0), c.get("gar", 0), c.get("fts", 0),
             c.get("fts_country"), c.get("workers_fns"), "CLIENT", 1.0),
        )
    # Реалистичные платежи и группа (кроме E2E_DEMO — у него специально нет платежей и группы)
    db.ex("INSERT OR REPLACE INTO payments VALUES(?,?,?,?)", ("E2E_AGRO", "E2E_LOG_P", 4.2e9, 48))
    db.ex("INSERT OR REPLACE INTO payments VALUES(?,?,?,?)", ("E2E_RET_P", "E2E_BEV", 8.5e9, 120))
    db.ex("INSERT OR REPLACE INTO payments VALUES(?,?,?,?)", ("E2E_AZS_P", "E2E_FUEL", 6.8e9, 95))
    db.ex("UPDATE companies SET group_id='G_AGRO' WHERE uid IN ('E2E_AGRO','E2E_LOG_P')")
    db.ex("INSERT OR REPLACE INTO group_stats VALUES(?,?,?)", ("G_AGRO", 2, 65.9e9))

    for idx, ev in enumerate(E2E_EVENTS + E2E_EXTRA_NEWS):
        pub = (now_dt - timedelta(hours=4 + idx * 2)).isoformat()
        tags = news.rule_tags(ev["title"], ev["text"])
        h = news.content_hash(ev["title"], ev["text"])
        db.ex(
            """INSERT OR REPLACE INTO news(id,url,title,text,source,source_id,origin,published,fetched,cluster_id,tags_json,extract_json,content_hash)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (ev["id"], ev["url"], ev["title"], ev["text"], ev["source"], ev["source_id"], "rss",
             pub, pub, ev["id"], db.j(tags), db.j(ev["extract"]), h),
        )
        if ev.get("clarification"):
            agent.add_clarification(ev["uid"], ev["role"], ev["id"], ev["clarification"], source="user_form")


def build_pool(ev: dict, with_bank: bool = True) -> tuple[dict, agent.Pool, dict]:
    uid, role, nid = ev["uid"], ev["role"], ev["id"]
    p = profile.build(uid)
    pool = agent.Pool()
    pool.add(agent.feat_items(p))
    pool.add(agent.clar_items(agent.list_clarifications(uid, role, nid)))
    ctx = {"uid": uid, "role": role, "run_id": "bench", "web_calls": 0, "web_limit": 0, "exclude_news": set()}
    base = tools.call("get_news", {"id": nid}, ctx)
    pool.add(base["items"])
    for tool, args in (("get_counterparties", {"side": "customers"}), ("get_counterparties", {"side": "suppliers"}), ("get_group_structure", {})):
        try:
            pool.add(tools.call(tool, args, ctx)["items"])
        except Exception:  # noqa: BLE001
            pass
    if with_bank:
        sc = ranking.reasons_for(uid, role, nid) or {"factors": []}
        q = " ".join(FACTORS[f]["label"] for f in sc["factors"][:3])
        try:
            pool.add(tools.call("search_bank_analytics", {"query": q, "factors": sc["factors"][:3]}, ctx)["items"])
        except tools.ToolError:
            pass
    return p, pool, base["items"][0]


def pack_row(variant: str, ev: dict, res: dict, rules: list[dict], crit: dict | None, cost: float, sec: float,
             *, agent_model: str, critic_model: str, reasoning_mode: str, readiness: str = "ready",
             sources_total: int | None = None) -> dict:
    scores = (crit or {}).get("scores") or {}
    num_vals = [float(v) for v in scores.values() if isinstance(v, (int, float))]
    num_rule = next((r for r in rules if r["id"] == "numbers"), None)
    opp_rule = next((r for r in rules if r["id"] == "opportunity_conditions"), None)
    user_rule = next((r for r in rules if r["id"] == "user_clarifications_used"), None)
    return {
        "variant": variant,
        "event_id": ev["id"],
        "uid": ev["uid"],
        "agent_model": agent_model,
        "critic_model": critic_model,
        "reasoning_mode": reasoning_mode,
        "ok": True,
        "readiness": readiness,
        "sec": round(sec, 1),
        "cost_rub": round(cost, 4),
        "rules_passed": sum(1 for r in rules if r["ok"]),
        "rules_total": len(rules),
        "failed_rules": [r["id"] for r in rules if not r["ok"]],
        "numbers_ok": bool(num_rule and num_rule["ok"]),
        "opp_cond_ok": bool(opp_rule and opp_rule["ok"]),
        "user_clar_ok": None if user_rule is None else bool(user_rule["ok"]),
        "critic_scores": scores,
        "critic_avg": round(sum(num_vals) / len(num_vals), 3) if num_vals else None,
        "critic_verdict": (crit or {}).get("verdict"),
        "contradictions": len((crit or {}).get("contradictions") or []),
        "has_bank": bool((res.get("bank_view") or {}).get("points") or (res.get("bank_view") or {}).get("summary")),
        "refs": len(agent.referenced(res)),
        "sources_total": sources_total if sources_total is not None else len(res.get("sources") or {}),
        "headline": str(res.get("headline") or "")[:110],
    }


def run_agent_variant(ev: dict, *, variant: str, agent_model: str, critic_model: str,
                      reasoning_mode: str, reasoning_purposes: set[str]) -> dict:
    """Предполагается, что config.MODELS / LLM_REASONING* выставлены на уровне варианта."""
    t0 = time.time()
    try:
        run = agent.Run("insight", ev["uid"], ev["role"], ev["id"])
        agent.run_insight(run, force=True)
        row = db.q1("SELECT status FROM runs WHERE id=?", (run.id,))
        c = agent.cached(ev["uid"], ev["role"], ev["id"])
        if not row or row["status"] not in ("ok", "needs_review") or not c:
            return {
                "variant": variant, "event_id": ev["id"], "uid": ev["uid"],
                "agent_model": agent_model, "critic_model": critic_model, "reasoning_mode": reasoning_mode,
                "ok": False, "error": (row or {}).get("status", "no_result"),
                "sec": round(time.time() - t0, 1), "cost_rub": round(run.cost(), 4),
            }
        res = agent.normalize(c)
        rules = c.get("rules") or []
        return pack_row(
            variant, ev, res, rules, c.get("critic"), run.cost(), time.time() - t0,
            agent_model=agent_model, critic_model=critic_model, reasoning_mode=reasoning_mode,
            readiness=c.get("readiness") or "ready", sources_total=len(c.get("sources") or {}),
        )
    except Exception as e:  # noqa: BLE001
        return {
            "variant": variant, "event_id": ev["id"], "uid": ev["uid"],
            "agent_model": agent_model, "critic_model": critic_model, "reasoning_mode": reasoning_mode,
            "ok": False, "error": f"{type(e).__name__}: {e}"[:180],
            "sec": round(time.time() - t0, 1), "cost_rub": 0.0,
        }


def run_single_variant(ev: dict, *, variant: str, agent_model: str, critic_model: str, with_bank: bool) -> dict:
    """Предполагается, что config.MODELS / LLM_REASONING* выставлены на уровне варианта."""
    t0 = time.time()
    try:
        p, pool, main = build_pool(ev, with_bank=with_bank)
        rl = agent.ROLES[ev["role"]]
        run = FakeRun(variant)
        rows = [f"[{main['id']}] {main['title']}\n{main.get('text', '')[:2500]}"]
        if with_bank:
            for sid, it in pool.items.items():
                if it["kind"] in ("bank", "feat", "user", "data"):
                    rows.append(f"[{sid}] {it.get('title', '')}: {(it.get('text') or '')[:550]}")
        sys_p = (
            f"Ты AI-аналитик Альфи в интернет-банке Альфа-Бизнес. Разбор события для роли {rl['label']} "
            f"(фокус: {rl['focus']}). Сегодня 2026-10-26. Пиши по-русски. "
            f"Не выдумывай цифры, не переноси рыночный рост на компанию, позицию банка бери строго из bank:*. {SINGLE_SCHEMA}"
        )
        user_p = f"КОМПАНИЯ:\n{profile.brief(p, 8)}\n\nИСТОЧНИКИ:\n{security.wrap_untrusted('\n\n'.join(rows[:24]))}"
        r, cr = llm.chat_json(
            [{"role": "system", "content": sys_p}, {"role": "user", "content": user_p}],
            role="agent", purpose=f"bench_{variant}", run_id=run.id, max_tokens=2600,
            temperature=0.2, timeout=180, reasoning=False,
        )
        cost = float(cr["cost"])
        res = agent.normalize(r if isinstance(r, dict) else {})
        rules = agent.verify(res, pool, main.get("text", ""))
        crit = agent.critique(res, pool, run)
        cost += float((crit or {}).get("cost") or 0.0)
        crit_failed = any(not x["ok"] and x["id"] in agent.CRITICAL_RULES for x in rules)
        contradictions = bool((crit or {}).get("contradictions"))
        readiness = "needs_review" if (crit_failed or contradictions or (crit or {}).get("verdict") == "revise") else "ready"
        return pack_row(
            variant, ev, res, rules, crit, cost, time.time() - t0,
            agent_model=agent_model, critic_model=critic_model, reasoning_mode="off",
            readiness=readiness, sources_total=len(agent.referenced(res)),
        )
    except Exception as e:  # noqa: BLE001
        return {
            "variant": variant, "event_id": ev["id"], "uid": ev["uid"],
            "agent_model": agent_model, "critic_model": critic_model, "reasoning_mode": "off",
            "ok": False, "error": f"{type(e).__name__}: {e}"[:180],
            "sec": round(time.time() - t0, 1), "cost_rub": 0.0,
        }


def summarize_variant(variant: str, rows: list[dict]) -> dict:
    ok = [r for r in rows if r.get("ok")]
    n_all = max(1, len(rows))
    if not ok:
        return {"variant": variant, "runs": len(rows), "ok_rate": 0.0}
    n = len(ok)
    axes = ("grounding", "personalization", "depth", "attribution", "source_fidelity", "no_overclaim")
    axis_avg = {}
    for ax in axes:
        vals = [float(r["critic_scores"][ax]) for r in ok if isinstance((r.get("critic_scores") or {}).get(ax), (int, float))]
        axis_avg[ax] = round(sum(vals) / len(vals), 3) if vals else None
    avg_cost = sum(r["cost_rub"] for r in ok) / n
    c_avgs = [r["critic_avg"] for r in ok if r.get("critic_avg") is not None]
    return {
        "variant": variant,
        "agent_model": ok[0]["agent_model"],
        "critic_model": ok[0]["critic_model"],
        "reasoning_mode": ok[0]["reasoning_mode"],
        "runs": len(rows),
        "ok_rate": round(n / n_all, 3),
        "rules_pct": round(sum(r["rules_passed"] for r in ok) / max(1, sum(r["rules_total"] for r in ok)), 4),
        "numbers_ok_rate": round(sum(1 for r in ok if r["numbers_ok"]) / n, 3),
        "opp_cond_ok_rate": round(sum(1 for r in ok if r["opp_cond_ok"]) / n, 3),
        "ready_rate": round(sum(1 for r in ok if r["readiness"] == "ready") / n, 3),
        "needs_review": sum(1 for r in ok if r["readiness"] == "needs_review"),
        "critic_avg": round(sum(c_avgs) / len(c_avgs), 3) if c_avgs else None,
        "critic_axes": axis_avg,
        "bank_coverage": f"{sum(1 for r in ok if r['has_bank'])}/{n}",
        "avg_refs": round(sum(r["refs"] for r in ok) / n, 1),
        "avg_sources_total": round(sum(r["sources_total"] for r in ok) / n, 1),
        "avg_sec": round(sum(r["sec"] for r in ok) / n, 1),
        "avg_cost_rub": round(avg_cost, 3),
        "total_cost_rub": round(sum(r["cost_rub"] for r in rows), 2),
        "insights_per_600_rub": int(600.0 / avg_cost) if avg_cost > 0 else 0,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="../docs/bench/results.json")
    ap.add_argument("--primary", default="deepseek/deepseek-v4.1-flash", help="Основная модель для сравнения режимов мышления и абляции")
    ap.add_argument("--models", default="deepseek/deepseek-v4.1-flash,z-ai/glm-5.3-flash,google/gemma-4-26b-a4b-it,qwen/qwen3.6-35b-a3b,moonshotai/kimi-k2.6")
    ap.add_argument("--events", type=int, default=5)
    args = ap.parse_args()

    if not config.LLM_API_KEY:
        raise SystemExit("Нужен LLM_API_KEY в окружении")

    events = E2E_EVENTS[: args.events]
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Расширяем внутренние лимиты сервиса на время бенчмарка
    config.BUDGET_SOFT_RUB = 560.0
    config.BUDGET_HARD_RUB = 580.0
    now_dt = datetime(2026, 10, 26, 20, 30, tzinfo=timezone.utc)

    # Формируем список экспериментов
    primary = args.primary
    primary_critic = pick_critic_for(primary)
    specs: list[dict[str, Any]] = []
    # 1. Сравнение моделей в роли агента (reasoning=off)
    for m in models:
        short = m.split("/")[-1]
        specs.append({
            "variant": f"model:{short}",
            "group": "models",
            "kind": "agent",
            "agent_model": m,
            "critic_model": pick_critic_for(m),
            "reasoning_mode": "off",
            "reasoning_purposes": set(),
        })
    # 2. Режимы рассуждений: только явные effort'ы low / medium / high (без неконтролируемого on!)
    specs.append({
        "variant": "effort:ds_low",
        "group": "reasoning",
        "kind": "agent",
        "agent_model": primary,
        "critic_model": primary_critic,
        "reasoning_mode": "selective",
        "reasoning_purposes": {"synth", "repair"},
        "reasoning_effort": "low",
    })
    specs.append({
        "variant": "effort:ds_medium",
        "group": "reasoning",
        "kind": "agent",
        "agent_model": primary,
        "critic_model": primary_critic,
        "reasoning_mode": "selective",
        "reasoning_purposes": {"synth", "repair"},
        "reasoning_effort": "medium",
    })
    specs.append({
        "variant": "effort:ds_high",
        "group": "reasoning",
        "kind": "agent",
        "agent_model": primary,
        "critic_model": primary_critic,
        "reasoning_mode": "selective",
        "reasoning_purposes": {"synth", "repair"},
        "reasoning_effort": "high",
    })
    specs.append({
        "variant": "effort:glm_medium",
        "group": "reasoning",
        "kind": "agent",
        "agent_model": "z-ai/glm-5.3-flash",
        "critic_model": "deepseek/deepseek-v4.1-flash",
        "reasoning_mode": "selective",
        "reasoning_purposes": {"synth", "repair"},
        "reasoning_effort": "medium",
    })
    specs.append({
        "variant": "effort:gemma_medium",
        "group": "reasoning",
        "kind": "agent",
        "agent_model": "google/gemma-4-26b-a4b-it",
        "critic_model": "z-ai/glm-5.3-flash",
        "reasoning_mode": "selective",
        "reasoning_purposes": {"synth", "repair"},
        "reasoning_effort": "medium",
    })
    specs.append({
        "variant": "effort:qwen_medium",
        "group": "reasoning",
        "kind": "agent",
        "agent_model": "qwen/qwen3.6-35b-a3b",
        "critic_model": "z-ai/glm-5.3-flash",
        "reasoning_mode": "selective",
        "reasoning_purposes": {"synth", "repair"},
        "reasoning_effort": "medium",
    })
    # 3. Абляция архитектуры на основной модели
    specs.append({
        "variant": "ablation:single_rag",
        "group": "ablation",
        "kind": "single_rag",
        "agent_model": primary,
        "critic_model": primary_critic,
        "reasoning_mode": "off",
        "reasoning_purposes": set(),
    })
    specs.append({
        "variant": "ablation:single_bare",
        "group": "ablation",
        "kind": "single_bare",
        "agent_model": primary,
        "critic_model": primary_critic,
        "reasoning_mode": "off",
        "reasoning_purposes": set(),
    })

    # Поддержка инкрементального сохранения
    existing: dict[tuple[str, str], dict] = {}
    if out_path.exists():
        try:
            prev = json.loads(out_path.read_text(encoding="utf-8"))
            for r in prev.get("rows") or []:
                if r.get("ok"):
                    existing[(r["variant"], r["event_id"])] = r
        except Exception:  # noqa: BLE001
            pass

    all_rows: list[dict] = []
    summaries: list[dict] = []
    total_spend = 0.0

    orig_rnow, orig_nnow = ranking.now, news.now
    with tempfile.TemporaryDirectory() as tmp:
        config.DB_PATH = Path(tmp) / "e2e_bench.db"
        db._local = threading.local()
        ranking.now = lambda: now_dt
        news.now = lambda: now_dt
        try:
            seed_e2e_db(now_dt)
            print(f"E2E-бенчмарк Альфи: {len(specs)} вариантов × {len(events)} событий = {len(specs)*len(events)} прогонов (до 3 потоков)", flush=True)
            old_models = dict(config.MODELS)
            old_mode, old_flag, old_purp = config.LLM_REASONING_MODE, config.LLM_REASONING, set(config.LLM_REASONING_PURPOSES)
            old_eff = config.LLM_REASONING_EFFORT
            old_web = config.MAX_WEB_SEARCH_PER_RUN
            for sp in specs:
                vname = sp["variant"]
                v_rows: list[dict] = []
                todo = []
                for ev in events:
                    cached = existing.get((vname, ev["id"]))
                    if cached:
                        cached["group"] = sp["group"]
                        v_rows.append(cached)
                    else:
                        todo.append(ev)

                if todo:
                    config.MODELS["agent"] = sp["agent_model"]
                    config.MODELS["critic"] = sp["critic_model"]
                    config.MODELS["fallback"] = sp["agent_model"]
                    config.LLM_REASONING_MODE = sp["reasoning_mode"]
                    config.LLM_REASONING = sp["reasoning_mode"] == "on"
                    config.LLM_REASONING_PURPOSES = set(sp["reasoning_purposes"])
                    config.LLM_REASONING_EFFORT = sp.get("reasoning_effort", "")
                    config.MAX_WEB_SEARCH_PER_RUN = 0
                    try:
                        def _run_ev(ev_item: dict, spec: dict = sp) -> dict:
                            if spec["kind"] == "agent":
                                return run_agent_variant(
                                    ev_item, variant=spec["variant"], agent_model=spec["agent_model"],
                                    critic_model=spec["critic_model"], reasoning_mode=spec["reasoning_mode"],
                                    reasoning_purposes=spec["reasoning_purposes"],
                                )
                            return run_single_variant(
                                ev_item, variant=spec["variant"], agent_model=spec["agent_model"],
                                critic_model=spec["critic_model"], with_bank=(spec["kind"] == "single_rag"),
                            )

                        with ThreadPoolExecutor(max_workers=3) as pool_ex:
                            futs = {pool_ex.submit(_run_ev, ev): ev["id"] for ev in todo}
                            for fut in as_completed(futs):
                                r = fut.result()
                                r["group"] = sp["group"]
                                v_rows.append(r)
                                st = r.get("readiness", "ok") if r.get("ok") else f"FAIL({r.get('error', '')[:40]})"
                                print(
                                    f"  {vname:24s} {r['event_id']:17s} {st:12s} "
                                    f"rules={r.get('rules_passed')}/{r.get('rules_total')} "
                                    f"crit={r.get('critic_avg')} refs={r.get('refs')}/{r.get('sources_total')} "
                                    f"{r.get('sec')}с {r.get('cost_rub', 0):.2f}₽",
                                    flush=True,
                                )
                    finally:
                        config.MODELS.update(old_models)
                        config.LLM_REASONING_MODE = old_mode
                        config.LLM_REASONING = old_flag
                        config.LLM_REASONING_PURPOSES = old_purp
                        config.LLM_REASONING_EFFORT = old_eff
                        config.MAX_WEB_SEARCH_PER_RUN = old_web

                order = {e["id"]: i for i, e in enumerate(events)}
                v_rows.sort(key=lambda x: order.get(x["event_id"], 999))
                all_rows.extend(v_rows)
                total_spend += sum(float(x.get("cost_rub") or 0.0) for x in v_rows)
                s = summarize_variant(vname, v_rows)
                s["group"] = sp["group"]
                summaries.append(s)
                payload = {
                    "meta": {
                        "benchmark": "Alfi-E2E v2.1 (off/low/medium/high)",
                        "events": [e["id"] for e in events],
                        "primary_model": primary,
                        "total_spend_rub": round(total_spend, 2),
                        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    },
                    "summary": summaries,
                    "rows": all_rows,
                }
                out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        finally:
            ranking.now = orig_rnow
            news.now = orig_nnow

    print("\n=== ИТОГОВАЯ СВОДКА Alfi-E2E v2.0 ===", flush=True)
    print(f"{'Вариант':24s} {'OK':5s} {'Прав↑':6s} {'Цифр↑':6s} {'Крит↑':6s} {'Ready':6s} {'Банк':5s} {'Ссыл':8s} {'Сек':5s} {'₽':6s} {'Шт/600₽':7s}")
    for s in summaries:
        if not s.get("ok_rate"):
            print(f"{s['variant']:24s} FAIL")
            continue
        print(
            f"{s['variant']:24s} {s['ok_rate']*100:4.0f}% {s['rules_pct']*100:5.1f}% "
            f"{s['numbers_ok_rate']*100:5.0f}% {s.get('critic_avg') or 0:5.3f}  "
            f"{s['ready_rate']*100:4.0f}%  {s['bank_coverage']:5s} "
            f"{s['avg_refs']:3.1f}/{s['avg_sources_total']:<4.1f} {s['avg_sec']:4.1f}  "
            f"{s['avg_cost_rub']:5.2f} {s['insights_per_600_rub']:7d}",
            flush=True,
        )
    print(f"\nВсего потрачено на E2E-бенчмарк: {total_spend:.2f} ₽", flush=True)


if __name__ == "__main__":
    main()
