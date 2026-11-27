"""Тесты финальных правок по всем 5 замечаниям жюри и критериям устойчивости."""
from __future__ import annotations

import ast
from datetime import datetime, timezone
from pathlib import Path

from app import agent, config, dates, db, feedback, ingest, news, nlp, profile, ranking, search, tools


def test_dates_validation_and_safe_parsing():
    now_dt = datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc)
    assert dates.parse_published("2099-01-01T00:00:00Z", now_dt=now_dt) == now_dt.isoformat()
    assert dates.parse_published("1999-05-01T00:00:00Z", now_dt=now_dt) is None
    assert dates.parse_published("25.10.2026", now_dt=now_dt).startswith("2026-10-25T00:00:00+00:00")
    assert dates.normalize_effective_date("2026") is None
    assert dates.normalize_effective_date("2026-10") is None
    assert dates.normalize_effective_date("15.11.2026") == "2026-11-15"
    assert dates.coarse_deadline_label("2026-10") == "в октябре 2026"
    assert dates.coarse_deadline_label("2027") == "в 2027 году"
    # parse_utc_safe не роняет скоринг на битых датах
    assert dates.parse_utc_safe("not-a-date", now_dt) == now_dt
    # Даты в тексте не должны ложно превращаться в дробные числа (23.10.2026 -> 23.1)
    assert nlp.numbers("Решение от 23.10.2026 и отчёт 11.09.2026 (2026-09-11): ставка 14,0%") == ["14"]


def test_consistent_text_tags_and_cache_update(article):
    url = "https://news.test/update-case?utm_source=tg&from=main"
    nid = news.submit("Первичная заметка по зерну", "Короткий текст про зерно.", url, "AAA")
    # Кладём старый кэш триажа и разбора
    db.ex("INSERT INTO triage(key,news_id,data_json,created) VALUES(?,?,?,?)", ("AAA|cfo", nid, '{"i":1}', "2026-10-26"))
    db.ex(
        "INSERT INTO insights(key,news_id,run_id,result_json,confidence,created,content_hash,readiness,clarification_hash) VALUES(?,?,?,?,?,?,?,?,?)",
        ("AAA|cfo", nid, "r1", '{"headline":"старый"}', 0.8, "2026-10-26", "oldhash", "ready", ""),
    )
    # Повторный сабмит того же URL (даже с другими UTM) с обновлённым текстом
    nid2 = news.submit(
        "Обновлённое решение ЦБ по ключевой ставке",
        "ЦБ повысил ключевую ставку до 18%, что усиливает кредитную нагрузку на заёмщиков и меняет условия рефинансирования.",
        "https://news.test/update-case?utm_medium=email",
        "AAA",
    )
    assert nid2 == nid
    row = news.get(nid, uid="AAA")
    assert "rate" in row["tags"]["factors"]
    assert db.q1("SELECT 1 FROM triage WHERE news_id=?", (nid,)) is None
    assert db.q1("SELECT 1 FROM insights WHERE news_id=?", (nid,)) is None


def test_ranking_prioritizes_direct_material_over_noise():
    db.ex(
        "INSERT OR REPLACE INTO companies(uid,sector,okved,okved_name,revenue,region,loa) VALUES(?,?,?,?,?,?,?)",
        ("BEV1", "beverages", "46.34", "Торговля оптовая напитками", 40e9, "г. Москва", 1.0),
    )
    profile.invalidate_cache()
    now_iso = datetime.now(timezone.utc).isoformat()
    # 1) Высокозначимое прямое событие (акциз на напитки)
    db.ex(
        """INSERT INTO news(id,url,title,text,source,source_id,origin,published,fetched,cluster_id,tags_json,extract_json)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("excise", "https://t.test/1", "Введение акцизов на безалкогольные напитки обсудили в Правительстве",
         "Правительство обсуждает новые акцизы на напитки в 2027 году.", "Интерфакс", "interfax", "rss", now_iso, now_iso, "excise",
         db.j({"business": True, "sectors": {"beverages": 2}, "factors": {"tax": 2, "regulation": 1}, "regions": [], "countries": []}),
         db.j({"business": True, "scope": "sector", "event_type": "решение регулятора", "sectors": ["beverages"],
               "factors": [{"id": "tax", "strength": 3}], "materiality": 4})),
    )
    # 2) Мелкий шум чужой отрасли в Москве (банкротство сети АЗС)
    db.ex(
        """INSERT INTO news(id,url,title,text,source,source_id,origin,published,fetched,cluster_id,tags_json,extract_json)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("azs", "https://t.test/2", "Сеть АЗС в Москве потребовали признать банкротом",
         "Кредиторы подали иск о банкротстве сети автозаправок в Москве.", "РБК", "rbc", "rss", now_iso, now_iso, "azs",
         db.j({"business": True, "sectors": {"fuel": 3}, "factors": {"credit": 3}, "regions": ["москв"], "countries": []}),
         db.j({"business": True, "scope": "company_specific", "event_type": "инцидент", "sectors": ["fuel"],
               "factors": [{"id": "credit", "strength": 2}], "materiality": 2})),
    )
    # 3) Лайфстайл-статистика в отрасли напитков (глинтвейн)
    db.ex(
        """INSERT INTO news(id,url,title,text,source,source_id,origin,published,fetched,cluster_id,tags_json,extract_json)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("glint", "https://t.test/3", "В год на одного россиянина приходится до 3 бокалов глинтвейна",
         "Опрос про потребление вина и глинтвейна зимой.", "Retail.ru", "retail", "rss", now_iso, now_iso, "glint",
         db.j({"business": True, "sectors": {"beverages": 1}, "factors": {"demand": 1}, "regions": ["москв"], "countries": []}),
         db.j({"business": True, "scope": "lifestyle", "event_type": "другое", "sectors": ["beverages"],
               "factors": [{"id": "demand", "strength": 1}], "materiality": 1})),
    )
    items = ranking.feed("BEV1", "cfo", triage_on=False)["items"]
    ids = [it["id"] for it in items]
    assert ids[0] == "excise"
    # Шумовые новости либо вообще отсекаются порогом, либо сильно ниже прямого события
    assert "azs" not in ids or ids.index("excise") < ids.index("azs")
    assert "glint" not in ids or ids.index("excise") < ids.index("glint")
    s_exc = ranking.reasons_for("BEV1", "cfo", "excise")["score"]
    s_azs = ranking.reasons_for("BEV1", "cfo", "azs")["score"]
    s_glint = ranking.reasons_for("BEV1", "cfo", "glint")["score"]
    assert s_exc > s_azs * 3 and s_exc > s_glint * 3


def test_verify_opportunity_conditions_and_unconfirmed_numbers():
    pool = agent.Pool()
    pool.add([
        {"id": "feat:sector", "kind": "feat", "title": "Отрасль", "text": "Зерно"},
        {"id": "feat:fts", "kind": "feat", "title": "ВЭД", "text": "Алжир"},
        {"id": "news:n1", "kind": "news", "title": "Экспорт в Алжир вырос на 40%", "text": "Экспорт РФ вырос на 40%."},
    ])
    res = agent.normalize({
        "headline": "Экспорт в Алжир",
        "kind": "chance",
        "what_happened": {"summary": "Экспорт вырос на 40%.", "facts": [{"text": "Рост на 40%", "sources": ["news:n1"]}]},
        "why_it_matters": {"text": "Компания ведёт ВЭД в Алжир и работает с зерном.", "sources": ["feat:sector", "feat:fts", "news:n1"]},
        "impact_channels": [{"factor": "trade", "explanation": "экспорт", "sources": ["news:n1"]}, {"factor": "agro", "explanation": "зерно", "sources": ["news:n1"]}],
        "risks": [{"title": "Риск", "text": "Потери до 999 млн ₽", "sources": ["news:n1"]}],
        "opportunities": [{"title": "Рост", "text": "Выручка компании вырастет на 40%", "conditions": "", "sources": ["news:n1"]}],
        "actions": [{"title": "Проверить квоты", "text": "Сверить экспортные контракты", "sources": ["news:n1"]}],
    })
    rules = {r["id"]: r for r in agent.verify(res, pool, "Экспорт в Алжир вырос на 40%")}
    assert not rules["numbers"]["ok"] and "999" in rules["numbers"]["unconfirmed"]
    assert not rules["opportunity_conditions"]["ok"]
    # Регрессия: пустой why_it_matters={} от модели не должен вызывать KeyError: 'sources'
    empty_res = agent.normalize({"headline": "Тест", "why_it_matters": {}})
    empty_rules = agent.verify(empty_res, pool, "Тест")
    assert any(r["id"] == "features" and not r["ok"] for r in empty_rules)


def test_insight_needs_review_and_preserves_additional_source_urls(article, monkeypatch):
    main_id = article("main1", title="Экспорт зерна и квоты", url="https://news.test/main1")
    extra_id = article("extra1", title="Дополнительная новость про порты", url="https://news.test/extra1")
    # Убеждаемся, что search_news и tools._search_news сохраняют url
    hits = search.search_news("порты", uid="AAA")
    assert hits and hits[0]["url"] == "https://news.test/extra1"
    tool_out = tools.call("search_news", {"query": "порты"}, {"uid": "AAA", "role": "cfo", "run_id": "t1"})
    assert tool_out["items"][0]["url"] == "https://news.test/extra1"

    # Имитируем разбор, в котором после repair всё ещё остались неподтверждённая цифра и противоречие
    monkeypatch.setattr(config, "LLM_API_KEY", "test")
    monkeypatch.setattr(config, "INSIGHT_DEMO", "0")
    monkeypatch.setattr(agent.llm, "reachable", lambda *a, **k: True)
    monkeypatch.setattr(agent.llm, "budget_state", lambda: {"spent_rub": 0, "soft_rub": 120, "hard_rub": 450, "reserved_rub": 0, "deep_allowed": True})

    bad_draft = {
        "headline": "Квоты на зерно", "kind": "risk",
        "what_happened": {"summary": "Обсуждают квоты.", "facts": [{"text": "Потери 777 млрд ₽", "sources": [f"news:{main_id}"]}]},
        "why_it_matters": {"text": "Компания торгует зерном в регионе.", "sources": ["feat:sector", "feat:region", f"news:{main_id}"]},
        "impact_channels": [{"factor": "agro", "explanation": "зерно", "sources": [f"news:{main_id}"]}, {"factor": "trade", "explanation": "экспорт", "sources": [f"news:{main_id}"]}],
        "affected_areas": [{"area": "revenue", "impact": "negative", "effect": "снижение", "sources": [f"news:{main_id}"]}],
        "risks": [{"title": "Квоты", "text": "Убыток 777 млрд ₽", "sources": [f"news:{main_id}"]}],
        "opportunities": [], "bank_view": {"summary": "", "points": [], "coverage": "none"},
        "scenarios": [{"name": "базовый", "text": "Без изменений", "trigger": "решение", "sources": [f"news:{main_id}"]}],
        "actions": [{"title": "Проверить контракты", "text": "Сверить отгрузки", "sources": [f"news:{main_id}"]}],
        "questions": [], "data_gaps": [], "confidence": 0.9,
    }

    def fake_chat_json(msgs, **kw):
        purpose = kw.get("purpose")
        if purpose == "plan":
            return {"goal": "проверить", "hypotheses": [], "steps": [{"tool": "search_news", "args": {"query": "порты"}, "why": "доп источник"}]}, {"model": "m", "cost": 0.01, "usage": {}}
        if purpose == "synth":
            return bad_draft, {"model": "m", "cost": 0.05, "ms": 100, "usage": {}}
        if purpose == "critic":
            return {"verdict": "revise", "scores": {"grounding": 0.3, "personalization": 0.8, "depth": 0.7, "attribution": 0.8, "source_fidelity": 0.5, "no_overclaim": 0.8},
                    "issues": [{"where": "risks", "problem": "неподтверждённая цифра 777", "fix": "убрать"}],
                    "contradictions": ["Источник А говорит о росте квот, источник Б о сокращении"], "missing_data": []}, {"model": "c", "cost": 0.02}
        return {"patch": {}, "changed": []}, {"model": "m", "cost": 0.01}

    monkeypatch.setattr(agent.llm, "chat_json", fake_chat_json)
    run = agent.Run("insight", "AAA", "cfo", main_id)
    agent.run_insight(run, force=True)

    run_row = db.q1("SELECT status FROM runs WHERE id=?", (run.id,))
    assert run_row["status"] == "needs_review"
    saved = agent.cached("AAA", "cfo", main_id)
    assert saved["readiness"] == "needs_review"
    assert saved["confidence"] <= 0.55
    assert "777" in saved["unconfirmed_numbers"]
    assert saved["contradictions"]
    # Дополнительный источник из search_news сохранён вместе со ссылкой URL!
    assert f"news:{extra_id}" in saved["sources"]
    assert saved["sources"][f"news:{extra_id}"]["url"] == "https://news.test/extra1"
    assert saved["sources"][f"news:{extra_id}"]["cited"] is False


def test_chat_scoped_by_event_preserves_refs_and_clarifications(client, auth, article, monkeypatch):
    n1 = article("ev1", title="Ставка ЦБ осталась 14%", url="https://news.test/ev1")
    n2 = article("ev2", title="Пошлины на зерно снижены", url="https://news.test/ev2")
    assert agent.chat_key("AAA", "cfo", None, n1) != agent.chat_key("AAA", "cfo", None, n2)
    assert agent.chat_key("AAA", "cfo", None, n1) != agent.chat_key("BBB", "cfo", None, n1)

    # Имитируем ответ чата с уточнением пользователя по ev1
    monkeypatch.setattr(agent.llm, "chat", lambda msgs, **kw: {
        "content": f"По оценке Альфи учтено уточнение [user:c1] по событию [news:{n1}].",
        "tool_calls": [], "usage": {}, "cost": 0.01, "model": "m", "ms": 50,
    })
    run = agent.Run("chat", "AAA", "cfo", n1)
    agent.run_chat(run, "Уточню: у нас 80% кредитов по фиксированной ставке")

    h1 = client.get(f"/api/chat?news_id={n1}", headers=auth("AAA")).json()["items"]
    h2 = client.get(f"/api/chat?news_id={n2}", headers=auth("AAA")).json()["items"]
    h_other = client.get(f"/api/chat?news_id={n1}", headers=auth("BBB")).json()["items"]
    assert len(h1) == 2
    assert h2 == [] and h_other == []
    # Ссылки на источники сохранились в истории чата!
    assert f"news:{n1}" in h1[1]["refs"]
    assert h1[1]["refs"][f"news:{n1}"]["url"] == "https://news.test/ev1"
    # Уточнение сохранилось для AAA и недоступно BBB
    clars_a = client.get(f"/api/insight/{n1}/clarifications", headers=auth("AAA")).json()["items"]
    clars_b = client.get(f"/api/insight/{n1}/clarifications", headers=auth("BBB")).json()["items"]
    assert len(clars_a) == 1 and "фиксированной ставке" in clars_a[0]["text"]
    assert clars_b == []

    # Явное добавление уточнения через API сбрасывает старый кэш разбора
    db.ex(
        "INSERT INTO insights(key,news_id,run_id,result_json,confidence,created,content_hash,readiness,clarification_hash) VALUES(?,?,?,?,?,?,?,?,?)",
        ("AAA|cfo", n2, "r2", '{"headline":"старый"}', 0.8, "2026-10-26", "", "ready", ""),
    )
    assert agent.cached("AAA", "cfo", n2) is not None
    resp = client.post(f"/api/insight/{n2}/clarify", headers=auth("AAA"), json={"text": "Наша компания не экспортирует в Азию"})
    assert resp.status_code == 200
    assert agent.cached("AAA", "cfo", n2) is None


def test_http_layer_separated_from_db_ingest_and_feedback_rules():
    """Пункт 5 жюри: в main.py нет сырых SQL-запросов, фоновых потоков загрузки и формул обратной связи."""
    src = Path(__file__).resolve().parents[1] / "app" / "main.py"
    code = src.read_text(encoding="utf-8")
    tree = ast.parse(code)
    forbidden_attrs = {("db", "q"), ("db", "q1"), ("db", "ex"), ("db", "exmany"), ("db", "conn"), ("db", "transaction")}
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            pair = (node.value.id, node.attr)
            if pair in forbidden_attrs:
                found.append(f"{pair[0]}.{pair[1]}:{node.lineno}")
    assert not found, f"Прямые SQL-вызовы в main.py: {found}"
    assert "threading" not in code
    assert "_FEEDBACK_DELTA" not in code
    # Доменные модули реально существуют и работают
    assert feedback.FEEDBACK_DELTA["useful"] > 0
    assert callable(ingest.startup) and callable(ingest.submit_user_news)
