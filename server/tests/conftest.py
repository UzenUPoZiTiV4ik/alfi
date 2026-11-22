import os
import threading
from datetime import datetime, timedelta, timezone
from functools import partial
from types import SimpleNamespace

import httpx
import pytest
from anyio.from_thread import start_blocking_portal

# Explicit environment before importing app.security. Never use developer secrets or live APIs.
os.environ.update(SESSION_SECRET="s" * 40, ALFI_DEMO_MODE="0", LLM_API_KEY="", EXA_API_KEY="",
                  INGEST_INTERVAL_MIN="0", INGEST_ON_START="0", ADMIN_API_TOKEN="", SITE_PASSWORD="", SITE_BASE="")

from app import config, db, main, profile, ranking, search, security, team


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.sqlite")
    monkeypatch.setattr(config, "KB_DIR", tmp_path / "kb")
    monkeypatch.setattr(config, "PDF_DIR", config.KB_DIR / "pdf")
    monkeypatch.setattr(config, "RAW_DIR", tmp_path / "raw")
    monkeypatch.setattr(db, "_local", threading.local())
    profile.build.cache_clear()
    main._feed_snapshot.cache_clear()
    security._hits.clear()
    search.invalidate()
    db.init()
    db.exmany("INSERT INTO companies(uid,sector,okved,okved_name,revenue,region) VALUES(?,?,?,?,?,?)",
              [(uid, "agro", "01", "Зерно", 2e10, "Москва") for uid in ("AAA", "BBB")])
    monkeypatch.setattr(team, "ensure_ai", lambda *_: None)
    monkeypatch.setattr(ranking, "start_triage", lambda *_: None)

    def no_network(*args, **kwargs):
        pytest.fail("Unexpected external HTTP request")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", no_network)
    yield
    db.conn().close()


@pytest.fixture
def client(request):
    host = getattr(request, "param", "192.0.2.1")
    transport = httpx.ASGITransport(app=main.app, client=(host, 50000))
    api = httpx.AsyncClient(transport=transport, base_url="https://testserver")
    with start_blocking_portal() as portal:
        with (
            portal.wrap_async_context_manager(main.app.router.lifespan_context(main.app)),
            portal.wrap_async_context_manager(api),
        ):
            def request(method, url, **kwargs):
                return portal.call(partial(api.request, method, url, **kwargs))

            yield SimpleNamespace(
                request=request,
                get=partial(request, "GET"),
                post=partial(request, "POST"),
                put=partial(request, "PUT"),
            )


@pytest.fixture
def auth():
    def headers(uid="AAA", role="cfo"):
        return {"Authorization": "Bearer " + security.issue(uid, role)}
    return headers


@pytest.fixture
def article():
    def create(nid, owner=None, title="Рынок зерна", days=0, cluster=None, url=None, extract=None):
        published = datetime.now(timezone.utc) - timedelta(days=days)
        db.ex("""INSERT INTO news(id,url,title,text,source,source_id,published,cluster_id,tags_json,extract_json,user_uid)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?)""", (nid, url or f"https://example.test/{nid}", title, title, nid,
              "user" if owner else "rss", published.isoformat(), cluster or nid,
              db.j({"business": True, "sectors": {"agro": 5}, "factors": {"credit": 2}}), db.j(extract), owner))
        return nid
    return create
