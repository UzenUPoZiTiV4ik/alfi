"""HTTP API (FastAPI) и раздача фронтенда.

Аутентификация: HMAC-токен в Authorization: Bearer. В демо клиент выбирает компанию и роль,
в продуктиве токен выдаёт SSO интернет-банка Альфа-Бизнес (uid и роль приходят из него).
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from functools import lru_cache
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import agent, config, db, gate, kb, llm, metrics, news, profile, ranking, sandbox, search, security, team
from .taxonomy import FACTORS, ROLES, SECTORS, TOPICS

@asynccontextmanager
async def lifespan(_app: FastAPI):
    _startup()
    yield


app = FastAPI(lifespan=lifespan, title="Альфи · новостная аналитика для крупного бизнеса", version="1.3.0",
              description="Персональные бизнес-инсайты из новостей и аналитики Альфа-Банка. Прототип для Альфа Хак.")
if config.CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"], expose_headers=["ETag", "X-Run-Id"])


app.add_middleware(gate.SiteGate)


@app.get("/gate", include_in_schema=False)
def gate_page(e: int = 0):
    return gate.page(bool(e))


@app.post("/api/gate", include_in_schema=False)
async def gate_login(request: Request):
    from urllib.parse import parse_qs
    body = (await request.body()).decode(errors="ignore")
    password = (parse_qs(body).get("password") or [""])[0]
    return gate.login(request, password)


@app.get("/gate.css", include_in_schema=False)
def gate_css():
    return FileResponse(config.WEB_DIR / "gate.css", media_type="text/css")


@app.get("/gate-cat.png", include_in_schema=False)
def gate_cat():
    return FileResponse(config.WEB_DIR / "gate-cat.png", media_type="image/png")


# ---------- Жизненный цикл ----------
def _stale() -> bool:
    last = db.q1("SELECT finished FROM ingest_log ORDER BY id DESC LIMIT 1")
    if not last:
        return True
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(last["finished"])).total_seconds() / 60
    return age >= max(5, config.INGEST_INTERVAL_MIN)


def _scheduler() -> None:
    """Новости собираются сами: при старте, если данные устарели, и дальше по расписанию."""
    if config.INGEST_ON_START or _stale():
        try:
            news.ingest()
        except Exception:  # noqa: BLE001 сбор повторится в следующий раз
            pass
    while config.INGEST_INTERVAL_MIN > 0:
        time.sleep(60)
        if _stale() and not news.state()["running"]:
            try:
                news.ingest()
            except Exception:  # noqa: BLE001
                pass


def _warm_feeds(rows: list[dict]) -> None:
    for row in rows:
        try:
            ranking.feed(row["uid"], row["role"], triage_on=False)
        except KeyError:
            continue  # компания могла исчезнуть после нового импорта


def _startup() -> None:
    db.init()
    kb.ensure_loaded()
    recent = db.q("SELECT substr(key, 1, instr(key, '|') - 1) uid, substr(key, instr(key, '|') + 1) role "
                  "FROM user_prefs ORDER BY updated DESC LIMIT 8")
    if recent:
        threading.Thread(target=_warm_feeds, args=(recent,), daemon=True).start()
    if config.INGEST_ON_START or config.INGEST_INTERVAL_MIN > 0:
        threading.Thread(target=_scheduler, daemon=True).start()


# ---------- Сессия ----------
COOKIE = "alfi_session"


class Session(BaseModel):
    uid: str
    role: str
    is_admin: bool = False


def bearer(request: Request) -> str | None:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    return token.strip() if scheme.lower() == "bearer" else None


def session(request: Request) -> Session:
    token = bearer(request) if "authorization" in request.headers else request.cookies.get(COOKIE)
    claims = security.verify(token)
    if not claims:
        raise HTTPException(401, "Нужен вход")
    uid, role = claims.get("uid"), claims.get("role")
    if not isinstance(uid, str) or not isinstance(role, str) or role not in ROLES:
        raise HTTPException(403, "Недопустимая компания или роль")
    if not config.DEMO_MODE and not security.verify_company_membership(claims, uid, role):
        raise HTTPException(403, "Нет доступа к компании или роли")
    return Session(uid=uid, role=role, is_admin=claims.get("is_admin") is True)


def admin(request: Request):
    token = bearer(request)
    claims = security.verify(token or request.cookies.get(COOKIE))
    if not security.is_service_admin(session=claims, token=request.headers.get("x-admin-token") or token):
        raise HTTPException(403, "Требуются служебные права")


def demo_only():
    if not config.DEMO_MODE:
        raise HTTPException(403, "Деморежим выключен")


def limit(s: Session, kind: str) -> None:
    if not security.rate_ok(s.uid, kind):
        security.log_event(s.uid, "rate_limit", kind)
        raise HTTPException(429, "Слишком много запросов, подождите минуту")


def sse(run_id: str, after_seq: int = 0) -> StreamingResponse:
    async def gen():
        yield f"event: start\ndata: {json.dumps({'run_id': run_id})}\n\n"
        async for ev in agent.events(run_id, after_seq):
            event_id = f"id: {ev['seq']}\n" if "seq" in ev else ""
            yield f"{event_id}event: {ev['type']}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "private, no-store", "X-Accel-Buffering": "no", "X-Run-Id": run_id})


# ---------- Служебное ----------
@app.get("/api/health")
def health(request: Request):
    if request.client and request.client.host in {"127.0.0.1", "::1"} and not request.headers.get("authorization") and not request.headers.get("x-admin-token"):
        return {"ok": bool(db.q1("SELECT 1 AS ready"))}
    admin(request)
    return {"ok": True, "news": db.q1("SELECT COUNT(*) n FROM news")["n"], "companies": db.q1("SELECT COUNT(*) n FROM companies")["n"],
            "kb_chunks": db.q1("SELECT COUNT(*) n FROM kb_chunks")["n"], "llm": bool(config.LLM_API_KEY), "exa": bool(config.EXA_API_KEY)}


@app.get("/api/meta")
def meta():
    return {"roles": {k: {"label": v["label"], "focus": v["focus"]} for k, v in ROLES.items()},
            "topics": TOPICS, "factors": {k: {"label": v["label"], "topic": v["topic"]} for k, v in FACTORS.items()},
            "sectors": {k: v["label"] for k, v in SECTORS.items()},
            "demo": config.DEMO_MODE}


@app.get("/api/demo/companies", dependencies=[Depends(demo_only)])
def demo_companies(q: str = "", sector: str = "", featured: bool = True):
    if featured and not q and not sector:
        return {"items": profile.featured()}
    sql = """SELECT c.uid, c.okved, c.okved_name, c.sector, c.revenue, c.region, c.city, c.fts, c.loa, c.group_id
             FROM companies c LEFT JOIN group_stats g ON g.group_id=c.group_id
             WHERE (c.revenue >= 15e9 OR g.revenue >= 15e9) AND c.uid NOT LIKE 'U_TEST_%'"""
    args: list = []
    if q:
        sql += " AND (c.uid = ? OR c.okved_name LIKE ? OR c.region LIKE ? OR c.okved LIKE ?)"
        like = f"%{q.strip()[:60]}%"
        args += [q.strip().upper(), like, like, f"{q.strip()[:10]}%"]
    if sector:
        sql += " AND c.sector = ?"
        args.append(sector)
    rows = db.q(sql + " ORDER BY c.revenue DESC LIMIT 40", args)
    return {"items": [{"uid": r["uid"], "title": profile.company_title(r), "sector": r["sector"], "sector_label": SECTORS[r["sector"]]["label"],
                       "revenue": r["revenue"], "revenue_label": profile.bn(r["revenue"]), "region": r["region"], "fts": bool(r["fts"]),
                       "credit": bool(r["loa"])} for r in rows]}


@app.get("/api/demo/templates", dependencies=[Depends(demo_only)])
def demo_templates():
    """Для тестовой плашки: компании из данных кейса и текстовые шаблоны «свой бизнес»."""
    return {"companies": profile.featured()[:8], "texts": sandbox.TEMPLATES}


class SandboxIn(BaseModel):
    description: str = Field(min_length=15, max_length=1200)


@app.post("/api/demo/company", dependencies=[Depends(demo_only)])
def demo_company(body: SandboxIn, request: Request):
    if not security.rate_ok(request.client.host if request.client else "?", "submit"):
        raise HTTPException(429, "Слишком много запросов")
    return sandbox.create(security.mask_pii(body.description)[0])


class SessionIn(BaseModel):
    uid: str = Field(min_length=3, max_length=20)
    role: str


def set_cookie(response: Response, request: Request, token: str):
    claims = security.verify(token)
    if not claims:
        raise HTTPException(401, "Сессия истекла")
    ttl = max(0, claims["exp"] - int(time.time()))
    response.set_cookie(COOKIE, token, max_age=ttl, path=config.SITE_BASE or "/", httponly=True, secure=request.url.scheme == "https", samesite="lax")
    response.headers["Cache-Control"] = "no-store"


@app.post("/api/auth/session", dependencies=[Depends(demo_only)])
@app.post("/api/session", dependencies=[Depends(demo_only)])
def create_session(body: SessionIn, request: Request, response: Response):
    if not security.rate_ok(request.client.host if request.client else "?", "session"):
        raise HTTPException(429, "Слишком много входов")
    if body.role not in ROLES:
        raise HTTPException(400, "Неизвестная роль")
    uid = body.uid.strip().upper()
    if not db.q1("SELECT 1 FROM companies WHERE uid=?", (uid,)):
        raise HTTPException(404, "Компания не найдена")
    team.ensure_ai(uid, body.role)  # ИИ подбирает команду в фоне, пока грузится лента
    token = security.issue(uid, body.role)
    set_cookie(response, request, token)
    return {"token": token, "uid": uid, "role": body.role, "ttl_h": config.SESSION_TTL_H}


@app.post("/api/auth/cookie")
def exchange_cookie(request: Request, response: Response, s: Session = Depends(session)):
    token = bearer(request)
    if not token:
        raise HTTPException(401, "Нужен Bearer-токен")
    set_cookie(response, request, token)
    return {"uid": s.uid, "role": s.role}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    response.delete_cookie(COOKIE, path=config.SITE_BASE or "/", httponly=True, secure=request.url.scheme == "https", samesite="lax")
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}


@app.get("/api/me")
def me(s: Session = Depends(session)):
    p = profile.build(s.uid)
    return {"uid": s.uid, "role": s.role, "role_label": ROLES[s.role]["label"], "focus": ROLES[s.role]["focus"],
            "company": {"title": p["title"], "sector": p["sector"], "sector_label": p["sector_label"], "revenue_label": p["revenue_label"],
                        "region": p["region"], "group": p["group"]["n"], "products": p["products"], "countries": p["countries"]},
            "budget": llm.budget_state()}


@app.get("/api/profile")
def get_profile(s: Session = Depends(session)):
    p = dict(profile.build(s.uid))
    p["sensitivities"] = sorted(p["sensitivities"].values(), key=lambda x: -x["value"])
    return p


# ---------- Команда помощников ----------
@app.get("/api/team")
def get_team(s: Session = Depends(session)):
    team.ensure_ai(s.uid, s.role)
    return team.get(s.uid, s.role)


class OwnHelper(BaseModel):
    id: str = Field(default="", max_length=24)
    name: str = Field(min_length=1, max_length=18)
    watch: str = Field(min_length=3, max_length=60)
    fur: str = Field(default="#EF3124", max_length=7)


class ScheduleIn(BaseModel):
    frequency: Literal["off", "now", "day", "week"]
    timezone: str = Field(default="UTC", max_length=80)


class TeamIn(BaseModel):
    schedules: dict[str, ScheduleIn] = Field(default_factory=dict, max_length=4)
    ids: list[str] = Field(default_factory=list, max_length=4)
    own: list[OwnHelper] = Field(default_factory=list, max_length=2)


@app.post("/api/team")
@app.put("/api/team")
def put_team(body: TeamIn, s: Session = Depends(session)):
    try:
        return team.save(s.uid, s.role, body.ids, [o.model_dump() for o in body.own],
                         {key: value.model_dump() for key, value in body.schedules.items()})
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.put("/api/team/{member_id}/schedule")
def put_schedule(member_id: str, body: ScheduleIn, s: Session = Depends(session)):
    try:
        return team.set_schedule(s.uid, s.role, member_id, body.frequency, body.timezone)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.delete("/api/team")
def reset_team(s: Session = Depends(session)):
    return team.save(s.uid, s.role, [], [])


# ---------- Лента и новости ----------
@app.get("/api/feed/status")
def feed_status(s: Session = Depends(session)):
    return {"triage_running": ranking.triage_running(s.uid, s.role), "team_selecting": team.selecting(s.uid, s.role),
            "ingest_running": news.ingest_running(), "ingest_interval_min": config.INGEST_INTERVAL_MIN,
            "ingest": db.q1("SELECT finished,new,sources FROM ingest_log ORDER BY id DESC LIMIT 1")}


@lru_cache(maxsize=32)
def _feed_snapshot(uid: str, role: str, browse: bool, revision: tuple):
    return ranking.feed(uid, role, browse=browse)


@app.get("/api/feed")
def get_feed(request: Request, q: str = Query("", max_length=200), offset: int = Query(0, ge=0),
             limit: int | None = Query(None, ge=1, le=200), s: Session = Depends(session)):
    team.ensure_ai(s.uid, s.role)
    status = feed_status(s)
    revision = (str(config.DB_PATH), db.q1("SELECT feed FROM content_revision")["feed"], int(time.time() // 60),
                status["triage_running"], status["team_selecting"])
    query = q.strip().casefold()
    browse = bool(query or offset or limit is not None)
    feed = _feed_snapshot(s.uid, s.role, browse, revision)
    items = feed["items"]
    if query:
        items = [item for item in items if query in " ".join(str(item.get(field) or "") for field in
                 ("title", "headline", "lead", "why", "source")).casefold()]
    size = limit if limit is not None else (config.FEED_SIZE if browse else len(items))
    result = {**feed, **status, "items": items[offset:offset+size], "total": len(items), "offset": offset,
              "limit": size, "has_more": offset+size < len(items)}
    version = hashlib.sha256(db.j({key: value for key, value in result.items() if key != "ms"}).encode()).hexdigest()
    etag = f'W/"{version}"'
    headers = {"ETag": etag, "Cache-Control": "private, no-cache", "Vary": "Authorization, Cookie"}
    matches = {value.strip().removeprefix("W/") for value in request.headers.get("if-none-match", "").split(",")}
    if "*" in matches or etag[2:] in matches:
        return Response(status_code=304, headers=headers)
    return JSONResponse({**result, "version": version}, headers=headers)


def require_news(news_id: str, s: Session) -> dict:
    item = news.get(news_id, uid=s.uid)
    if not item:
        raise HTTPException(404, "Новость не найдена")
    return item


@app.get("/api/news/{news_id}")
def get_news(news_id: str, s: Session = Depends(session)):
    n = require_news(news_id, s)
    sc = ranking.reasons_for(s.uid, s.role, news_id)
    n["reasons"] = (sc or {}).get("reasons", [])
    n["parts"] = (sc or {}).get("parts")
    return n


class SubmitIn(BaseModel):
    title: str = Field(min_length=8, max_length=300)
    text: str = Field(default="", max_length=8000)
    url: str | None = Field(default=None, max_length=500)


@app.post("/api/news/submit")
def submit_news(body: SubmitIn, s: Session = Depends(session)):
    limit(s, "submit")
    if body.url and not body.url.startswith(("http://", "https://")):
        raise HTTPException(400, "Ссылка должна начинаться с http(s)://")
    text = body.text
    if body.url and len(text) < 200:
        try:
            from . import exa
            got = exa.contents([body.url], chars=6000)
            if got and got[0]["text"]:
                text = got[0]["text"]
        except Exception:  # noqa: BLE001 работаем с тем, что ввёл пользователь
            pass
    if security.injection_score(body.title + " " + text):
        security.log_event(s.uid, "prompt_injection_submit", body.title[:200])
    clean, _ = security.mask_pii(text)
    nid = news.submit(body.title, clean, body.url, s.uid)
    sc = ranking.reasons_for(s.uid, s.role, nid)
    return {"id": nid, "score": round((sc or {}).get("score", 0), 3), "reasons": (sc or {}).get("reasons", []),
            "relevant": bool(sc and sc["score"] >= config.FEED_THRESHOLD)}


# ---------- Разбор ----------
@app.get("/api/insight/{news_id}")
def get_insight(news_id: str, s: Session = Depends(session)):
    r = agent.cached(s.uid, s.role, news_id)
    if not r:
        return JSONResponse({"cached": False}, status_code=404)
    return r


@app.get("/api/insight/{news_id}/stream")
def stream_insight(news_id: str, force: bool = False, s: Session = Depends(session)):
    require_news(news_id, s)
    def on_new():
        if force or not agent.cached(s.uid, s.role, news_id):
            limit(s, "insight")

    return sse(agent.start_insight(s.uid, s.role, news_id, force=force, on_new=on_new).id)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    news_id: str | None = None
    helper: str | None = Field(default=None, max_length=40)


@app.post("/api/chat")
def chat(body: ChatIn, s: Session = Depends(session)):
    if body.news_id:
        require_news(body.news_id, s)
    limit(s, "chat")
    helper = None
    if body.helper:
        helper = next((m for m in team.get(s.uid, s.role)["members"] if m["id"] == body.helper), None)
    return sse(agent.start_chat(s.uid, s.role, body.message, body.news_id, helper).id)


@app.get("/api/chat")
def chat_history(helper: str = "", s: Session = Depends(session)):
    return {"items": agent.chat_history(s.uid, s.role, helper or None)}


@app.delete("/api/chat")
def chat_clear(helper: str = "", s: Session = Depends(session)):
    agent.chat_clear(s.uid, s.role, helper or None)
    return {"ok": True}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str, s: Session = Depends(session)):
    state = agent.run_state(run_id, s.uid, s.role)
    if not state:
        raise HTTPException(404, "Запуск не найден")
    return state


@app.get("/api/runs/{run_id}/stream")
def resume_run(run_id: str, after_seq: int = Query(0, ge=0), last_event_id: int | None = Header(None, ge=0),
               s: Session = Depends(session)):
    get_run(run_id, s)
    return sse(run_id, max(after_seq, last_event_id or 0))


@app.get("/api/runs/{run_id}/trace")
def run_trace(run_id: str, s: Session = Depends(session)):
    t = agent.trace(run_id)
    if not t or t["uid"] != s.uid or t["role"] != s.role:
        raise HTTPException(404, "Запуск не найден")
    return t


# ---------- Обратная связь ----------
class FeedbackIn(BaseModel):
    news_id: str
    kind: str = Field(pattern="^(useful|not_relevant|undo|undo_useful|neutral|rating|expert|action)$")
    value: int = 0
    comment: str = Field(default="", max_length=1000)


@app.post("/api/feedback")
def feedback(body: FeedbackIn, s: Session = Depends(session)):
    require_news(body.news_id, s)
    if body.kind in {"useful", "not_relevant", "neutral", "undo", "undo_useful"}:
        return {"ok": True, **ranking.set_feedback(s.uid, s.role, body.news_id, body.kind)}
    db.ex("INSERT INTO feedback(ts,uid,role,news_id,kind,value,comment) VALUES(?,?,?,?,?,?,?)",
          (datetime.now(timezone.utc).isoformat(), s.uid, s.role, body.news_id, body.kind, body.value, security.mask_pii(body.comment)[0]))
    return {"ok": True, "weights": None}


# ---------- База знаний ----------
@app.get("/api/kb/docs")
def kb_docs(s: Session = Depends(session)):
    return {"items": [d for d in kb.docs() if security.can_access_kb_doc(s.model_dump(), d)]}


def require_doc(doc_id: str, s: Session):
    doc = db.q1("SELECT * FROM kb_docs WHERE id=?", (doc_id,))
    if not security.can_access_kb_doc(s.model_dump(), doc):
        raise HTTPException(404, "Документ не найден")
    return doc


@app.get("/api/kb/search")
def kb_search(q: str = Query(min_length=1, max_length=300), limit: int = Query(8, ge=1, le=50), s: Session = Depends(session)):
    return {"items": search.search_kb(q, k=limit, session=s.model_dump())}


@app.get("/api/kb/docs/{doc_id}")
def kb_doc(doc_id: str, s: Session = Depends(session)):
    doc = kb.doc(doc_id)
    if not security.can_access_kb_doc(s.model_dump(), doc):
        raise HTTPException(404, "Документ не найден")
    return doc


@app.get("/api/kb/chunks/{chunk_id}")
def kb_chunk(chunk_id: str, s: Session = Depends(session)):
    chunk = kb.chunk(chunk_id)
    if not chunk:
        raise HTTPException(404, "Фрагмент не найден")
    require_doc(chunk["doc_id"], s)
    return chunk


@app.get("/api/kb/pdf/{doc_id}")
def kb_pdf(doc_id: str, s: Session = Depends(session)):
    doc = require_doc(doc_id, s)
    root = config.PDF_DIR.resolve()
    path = (root / doc["file"]).resolve()
    if not path.is_relative_to(root):
        raise HTTPException(404, "PDF не найден")
    if not path or not path.exists():
        raise HTTPException(404, "PDF не найден")
    return FileResponse(path, media_type="application/pdf", headers={"Content-Disposition": "inline"})


# ---------- Метрики и сбор ----------
@app.get("/api/metrics", dependencies=[Depends(admin)])
def get_metrics():
    return metrics.all_metrics()


@app.get("/api/ingest/state", dependencies=[Depends(admin)])
def ingest_state():
    return news.state()


@app.post("/api/ingest/run", dependencies=[Depends(admin)])
def ingest_run():
    if not security.rate_ok("service-admin", "ingest"):
        raise HTTPException(429, "Слишком много запросов")
    if news.state()["running"]:
        return {"status": "busy"}
    threading.Thread(target=news.ingest, daemon=True).start()
    return {"status": "started"}


# Последний маршрут обслуживает фронтенд.
app.mount("/", StaticFiles(directory=config.WEB_DIR, html=True), name="web")
