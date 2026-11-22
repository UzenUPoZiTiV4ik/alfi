from datetime import datetime

from app import config, db, news, nlp, ranking, search, team


def test_shared_url_and_company_cluster_boundaries(article, client, auth):
    url = "https://news.test/shared"
    ids = [news.submit("Новая цена на зерно", "Контекст " + owner, url, owner) for owner in ("AAA", "BBB")]
    news.upsert([dict(url=url, title="Новая цена на зерно", text="Общее", source="Вестник", source_id="rss", origin="rss")])
    news.tag_new()
    public = db.q1("SELECT id FROM news WHERE user_uid IS NULL")["id"]
    news.cluster()
    assert len({*ids, public}) == 3
    assert news.submit("Другой заголовок", "", url, "AAA") == ids[0]
    for nid in (public, *ids):
        assert db.q1("SELECT cluster_id FROM news WHERE id=?", (nid,))["cluster_id"] == nid
    assert news.get(ids[0]) is None
    assert news.get(public)["user_uid"] is None
    assert client.get(f"/api/news/{ids[1]}", headers=auth()).status_code == 404
    assert client.get(f"/api/insight/{ids[1]}/stream", headers=auth()).status_code == 404
    assert client.post("/api/chat", headers=auth(), json={"message": "поясни", "news_id": ids[1]}).status_code == 404
    assert ranking.reasons_for("AAA", "cfo", ids[1]) is None
    # Simulate old inconsistent cluster data. Source counts and results stay scoped.
    article("foreign", "BBB", cluster=public)
    article("matching", cluster=public)
    public_card = next(r for r in ranking.candidates("AAA") if r["id"] == public)
    assert public_card["n_sources"] == 2
    assert {r["id"] for r in news.get(public)["cluster"]} == {"matching"}
    assert {r["id"] for r in ranking.candidates("AAA")} == {ids[0], public}
    assert ranking.corpus_stats("AAA")["scanned"] == 3


def test_search_scopes_corpus_before_bm25(article, monkeypatch):
    article("own", "AAA", title="Зерно доступно")
    article("old", "AAA", title="Зерно вчера", days=30)
    article("other", "BBB", title="Зерно чужое")
    article("public", title="Зерно новое")
    captured = []
    original = nlp.BM25

    def capture(docs):
        captured.append(len(docs))
        return original(docs)

    monkeypatch.setattr(nlp, "BM25", capture)
    assert {r["news_id"] for r in search.search_news("зерно", days=5, uid="AAA")} == {"own", "public"}
    assert captured == [2]
    assert [r["news_id"] for r in search.search_news("зерно")] == ["public"]


def test_feedback_idempotence_and_undo(client, auth, article):
    nid = article("feedback", "AAA")

    def post(kind):
        return client.post("/api/feedback", headers=auth(), json={"news_id": nid, "kind": kind}).json()

    useful = post("useful")
    assert useful["state"] == "useful"
    assert useful["weights"]["sector:agro"] == 1.15
    assert post("useful") == useful
    assert post("undo") == useful
    assert post("undo_useful")["weights"]["sector:agro"] == 1
    hidden = post("not_relevant")
    assert hidden["weights"]["sector:agro"] == 0.8
    assert post("not_relevant") == hidden
    assert not client.get("/api/feed", headers=auth()).json()["items"]
    assert post("undo")["state"] == "neutral"
    assert client.get("/api/feed", headers=auth()).json()["items"][0]["feedback_state"] == "neutral"
    assert post("neutral")["weights"]["sector:agro"] == 1
    assert client.post("/api/feedback", headers=auth("BBB"), json={"news_id": nid, "kind": "useful"}).status_code == 404


def test_feed_search_pagination_status_etag(client, auth, article, monkeypatch):
    for i in range(8):
        article(str(i), title=f"Зерно обзор {i}")
    article("other", title="Урожай пшеницы")
    article("invisible", "BBB", title="Зерно обзор компании")
    url = "/api/feed?q=ОБЗОР&limit=3&offset=2"
    page = client.get(url, headers=auth())
    assert page.status_code == 200
    data = page.json()
    assert (data["total"], data["offset"], data["limit"], len(data["items"]), data["has_more"]) == (8, 2, 3, 3, True)
    assert len(client.get("/api/feed?q=обзор&limit=3&offset=7", headers=auth()).json()["items"]) == 1
    with monkeypatch.context() as m:
        m.setattr(ranking, "feed", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("ranked twice")))
        empty = client.get(url, headers={**auth(), "If-None-Match": page.headers["etag"]})
        assert empty.status_code == 304 and empty.content == b""
        assert not client.get("/api/feed/status", headers=auth()).json()["ingest_running"]
    article("extra", title="Обзор цен на зерно")
    changed = client.get(url, headers={**auth(), "If-None-Match": page.headers["etag"]})
    assert changed.status_code == 200 and changed.json()["total"] == 9
    assert len(client.get("/api/feed", headers=auth()).json()["items"]) <= config.FEED_SIZE


def test_bank_ref_cache_reuse_and_invalidation(article, monkeypatch):
    article("a-cache")
    calls = []

    def refs(*args, **kwargs):
        calls.append(args)
        return []

    monkeypatch.setattr(search, "bank_refs_for", refs)
    for _ in range(2):
        ranking.feed("AAA", "cfo", triage_on=False)
    assert len(calls) == 1
    db.ex("INSERT INTO kb_docs(id) VALUES('fresh')")
    ranking.feed("AAA", "cfo", triage_on=False)
    assert len(calls) == 2
    search.invalidate()
    ranking.feed("AAA", "cfo", triage_on=False)
    assert len(calls) == 3


def test_zero_score_own_news_remains_visible(article):
    article("zero", "AAA", title="Новая заметка")
    db.ex("UPDATE news SET tags_json='{}' WHERE id='zero'")
    item, = ranking.feed("AAA", "cfo", triage_on=False)["items"]
    assert item["id"] == "zero" and item["score"] == 0


def test_validates_each_llm_entry_separately(article, monkeypatch):
    ids = [article(str(i), "AAA", extract={"effective_date": 42}) for i in range(3)]
    template = {"i": 1, "headline": "Проверить поставки", "why": "Спрос", "kind": "risk", "urgency": 2, "relevant": True}
    rows = [[], {**template, "i": 0}, {**template, "i": 1, "effective_date": 123},
            {**template, "i": 2, "urgency": "много"}, {**template, "i": 3, "effective_date": "2027-03-01T01:00:00Z"}]
    monkeypatch.setattr(ranking.llm, "chat_json", lambda *_, **__: ({"items": rows}, {}))
    assert ranking.triage("AAA", "cfo", ids) == 2
    cards = {it["id"]: it for it in ranking.feed("AAA", "cfo", triage_on=False)["items"]}
    assert cards["0"]["effective_date"] is None and cards["0"]["triaged"]
    assert cards["1"]["headline"] == "Рынок зерна" and not cards["1"]["triaged"]
    assert cards["2"]["effective_date"] == "2027-03-01"


def test_schedules_and_atomic_rejection(client, auth):
    member = client.get("/api/team", headers=auth()).json()["members"][0]["id"]
    body = {"ids": [member], "schedules": {member: {"frequency": "day", "timezone": "Europe/Moscow"}}}
    saved = client.put("/api/team", json=body, headers=auth()).json()["members"][0]
    assert saved["frequency"] == "day" and saved["timezone"] == "Europe/Moscow"
    assert datetime.fromisoformat(saved["next_run_at"]).hour == 6
    url = f"/api/team/{member}/schedule"
    changed = client.put(url, headers=auth(), json={"frequency": "week", "timezone": "America/New_York"}).json()
    assert datetime.fromisoformat(changed["next_run_at"]).weekday() == 0
    body["schedules"] = {member: {"frequency": "day", "timezone": "Bad/Zone"}}
    assert client.post("/api/team", json=body, headers=auth()).status_code == 422
    assert client.get("/api/team", headers=auth()).json()["members"][0]["frequency"] == "week"
    assert client.put(url, headers=auth(), json={"frequency": "off"}).json()["next_run_at"] is None
    assert team.next_run_at("week", "America/New_York", datetime.fromisoformat("2026-03-06T18:00:00+00:00")) == "2026-03-09T13:00:00+00:00"
