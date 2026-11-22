import os
import subprocess
import sys

import pytest

from app import config, db, main, security


@pytest.mark.parametrize("demo,secret,success", [("no", "short", False), ("yes", "", False), ("0", "ю" * 16, True),
                                               ("TRUE", "", True), ("1", "short", True)])
def test_secret_at_import(demo, secret, success):
    child = subprocess.run([sys.executable, "-c", "from app import security"], capture_output=True, text=True,
                           env={**os.environ, "ALFI_DEMO_MODE": demo, "SESSION_SECRET": secret})
    assert (child.returncode == 0) == success
    if not success:
        assert "SESSION_SECRET" in child.stderr


@pytest.mark.parametrize("method,url,body", [("GET", "/api/demo/companies", None), ("GET", "/api/demo/templates", None),
    ("POST", "/api/demo/company", {"description": "Тест зерновой компании"}),
    ("POST", "/api/session", {"uid": "AAA", "role": "cfo"}), ("POST", "/api/auth/session", {"uid": "AAA", "role": "cfo"})])
def test_production_demo_gate(client, method, url, body):
    assert client.request(method, url, json=body).status_code == 403


def test_demo_cookie_and_logout(client, monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", True)
    assert client.get("/api/demo/companies?featured=false").status_code == 200
    assert client.get("/api/demo/templates").status_code == 200
    result = client.post("/api/session", json={"uid": "AAA", "role": "cfo"})
    assert result.status_code == 200
    cookie = result.headers["set-cookie"].lower()
    assert all(flag in cookie for flag in ("httponly", "samesite=lax", "secure"))
    assert client.get("/api/me").json()["uid"] == "AAA"
    assert client.post("/api/auth/logout").json() == {"ok": True}
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer " + result.json()["token"]}).status_code == 200


def test_verified_cookie_exchange_and_membership(client, auth, monkeypatch):
    assert client.post("/api/auth/cookie", headers=auth()).json() == {"uid": "AAA", "role": "cfo"}
    assert client.get("/api/team").status_code == 200
    monkeypatch.setattr(security, "verify_company_membership", lambda *_: False)
    assert client.get("/api/team").status_code == 403
    assert client.get("/api/team", headers={"Authorization": "Bearer invalid"}).status_code == 401


@pytest.mark.parametrize("path,method", [("/api/metrics", "get"), ("/api/health", "get"),
                                         ("/api/ingest/state", "get"), ("/api/ingest/run", "post")])
def test_service_routes(client, auth, monkeypatch, path, method):
    monkeypatch.setattr(config, "ADMIN_API_TOKEN", "service-token")
    monkeypatch.setattr(main.news, "state", lambda: {"running": True})
    call = getattr(client, method)
    assert call(path).status_code == 403
    assert call(path, headers=auth()).status_code == 403
    for headers in ({"X-Admin-Token": "service-token"}, {"Authorization": "Bearer service-token"}):
        assert call(path, headers=headers).status_code == 200


def test_signed_admin_claim(client, auth, monkeypatch):
    verify = security.verify
    monkeypatch.setattr(security, "verify", lambda token: {**verify(token), "is_admin": True} if verify(token) else None)
    assert client.get("/api/health", headers=auth()).status_code == 200


def test_kb_acl_all_surfaces_and_cache_invalidation(client, auth, article):
    directory = config.KB_DIR / "pdf"
    directory.mkdir(parents=True)
    (directory / "bank.pdf").write_bytes(b"%PDF-test")
    db.ex("INSERT INTO kb_docs(id,file,title,meta_json) VALUES('bank','bank.pdf','Рынок зерна',?)",
          (db.j({"company_uids": ["AAA"], "roles": ["cfo"]}),))
    db.ex("""INSERT INTO kb_chunks(id,doc_id,kind,page,text,sectors_json) VALUES('bank:t1','bank','thesis',1,
             'Обзор рынка зерна и урожая','["agro"]')""")
    for path in ("/api/kb/docs/bank", "/api/kb/chunks/bank:t1", "/api/kb/pdf/bank"):
        assert client.get(path).status_code == 401
        assert client.get(path, headers=auth()).status_code == 200
        for headers in (auth("BBB"), auth(role="owner")):
            assert client.get(path, headers=headers).status_code == 404
    for path in ("/api/kb/search?q=зерно", "/api/kb/docs"):
        assert client.get(path, headers=auth()).json()["items"]
        assert not client.get(path, headers=auth("BBB")).json()["items"]
    # After changing the ACL even an already indexed search/previous feed must hide it.
    article("grain")
    client.get("/api/feed", headers=auth()).raise_for_status()
    db.ex("UPDATE kb_docs SET meta_json=?", (db.j({"roles": []}),))
    assert not client.get("/api/kb/search?q=зерно", headers=auth()).json()["items"]
    assert not client.get("/api/feed", headers=auth()).json()["items"][0]["bank_refs"]
