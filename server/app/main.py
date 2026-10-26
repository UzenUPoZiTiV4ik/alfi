"""http api и раздача фронтенда из web/.

в демо клиент сам выбирает компанию и роль, в проде токен должен приходить из SSO.
"""
from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from typing import Iterator

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import agent, config, db, gate, kb, llm, metrics, news, profile, ranking, sandbox, security, team
from .taxonomy import FACTORS, ROLES, SECTORS, TOPICS

app = FastAPI(title="Альфи · новостная аналитика для крупного бизнеса", version="1.0.0",
              description="Персональные бизнес-инсайты из новостей и аналитики Альфа-Банка. Прототип для Альфа Хак.")
if config.CORS_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def site_gate(request: Request, call_next):
    """Без пароля не пускаем ни на страницы, ни в api."""
    if config.SITE_PASSWORD:
        stop = gate.guard(request)
        if stop is not None:
            return stop
    return await call_next(request)


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

@app.on_event("startup")
def _startup() -> None:
    db.init()
    kb.ensure_loaded()
    if config.INGEST_ON_START or config.INGEST_INTERVAL_MIN > 0:
        threading.Thread(target=_scheduler, daemon=True).start()

class Session(BaseModel):
    uid: str
    role: str

def session(authorization: str | None = Header(default=None)) -> Session:
    tok = (authorization or "").removeprefix("Bearer ").strip()
    p = security.verify(tok)
    if not p:
        raise HTTPException(401, "Нужен вход: выберите компанию и роль")
    return Session(uid=p["uid"], role=p["role"])

def limit(s: Session, kind: str) -> None:
    if not security.rate_ok(s.uid, kind):
        security.log_event(s.uid, "rate_limit", kind)
        raise HTTPException(429, "Слишком много запросов, подождите минуту")

def sse(run: agent.Run) -> StreamingResponse:
    def gen() -> Iterator[str]:
        yield f"event: start\ndata: {json.dumps({'run_id': run.id}, ensure_ascii=False)}\n\n"
        for ev in run.events():
            yield f"event: {ev['type']}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
        yield "event: end\ndata: {}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "X-Run-Id": run.id})

@app.get("/api/health")
def health():
    return {"ok": True, "news": db.q1("SELECT COUNT(*) n FROM news")["n"], "companies": db.q1("SELECT COUNT(*) n FROM companies")["n"],
            "kb_chunks": db.q1("SELECT COUNT(*) n FROM kb_chunks")["n"], "llm": bool(config.LLM_API_KEY), "exa": bool(config.EXA_API_KEY)}

@app.get("/api/meta")
def meta():
    return {"roles": {k: {"label": v["label"], "focus": v["focus"]} for k, v in ROLES.items()},
            "topics": TOPICS, "factors": {k: {"label": v["label"], "topic": v["topic"]} for k, v in FACTORS.items()},
            "sectors": {k: v["label"] for k, v in SECTORS.items()}, "models": config.MODELS, "budget": llm.budget_state(),
            "demo": config.DEMO_MODE}

@app.get("/api/demo/companies")
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

@app.get("/api/demo/templates")
def demo_templates():
    """Для тестовой плашки: компании из данных кейса и текстовые шаблоны «свой бизнес»."""
    return {"companies": profile.featured()[:8], "texts": sandbox.TEMPLATES}

class SandboxIn(BaseModel):
    description: str = Field(min_length=15, max_length=1200)

@app.post("/api/demo/company")
def demo_company(body: SandboxIn, request: Request):
    if not config.DEMO_MODE:
        raise HTTPException(403, "Тестовый режим выключен")
    if not security.rate_ok(request.client.host if request.client else "?", "submit"):
        raise HTTPException(429, "Слишком много запросов")
    return sandbox.create(security.mask_pii(body.description)[0])

class SessionIn(BaseModel):
    uid: str = Field(min_length=3, max_length=20)
    role: str

@app.post("/api/session")
def create_session(body: SessionIn, request: Request):
    if not config.DEMO_MODE:
        raise HTTPException(403, "Вход только через SSO интернет-банка")
    if not security.rate_ok(request.client.host if request.client else "?", "session"):
        raise HTTPException(429, "Слишком много входов")
    if body.role not in ROLES:
        raise HTTPException(400, "Неизвестная роль")
    uid = body.uid.strip().upper()
    if not db.q1("SELECT 1 FROM companies WHERE uid=?", (uid,)):
        raise HTTPException(404, "Компания не найдена")
    team.ensure_ai(uid, body.role)  # ИИ подбирает команду в фоне, пока грузится лента
    return {"token": security.issue(uid, body.role), "uid": uid, "role": body.role, "ttl_h": config.SESSION_TTL_H}

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

@app.get("/api/team")
def get_team(s: Session = Depends(session)):
    team.ensure_ai(s.uid, s.role)
    return team.get(s.uid, s.role)

class OwnHelper(BaseModel):
    id: str = Field(default="", max_length=24)
    name: str = Field(min_length=1, max_length=18)
    watch: str = Field(min_length=3, max_length=60)
    fur: str = Field(default="#EF3124", max_length=7)

class TeamIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=4)
    own: list[OwnHelper] = Field(default_factory=list, max_length=2)

@app.put("/api/team")
def put_team(body: TeamIn, s: Session = Depends(session)):
    return team.save(s.uid, s.role, body.ids, [o.model_dump() for o in body.own])

@app.delete("/api/team")
def reset_team(s: Session = Depends(session)):
    return team.save(s.uid, s.role, [], [])

@app.get("/api/feed")
def get_feed(s: Session = Depends(session)):
    team.ensure_ai(s.uid, s.role)
    f = ranking.feed(s.uid, s.role)
    f["triage_running"] = ranking.triage_running(s.uid, s.role)
    st = news.state()
    f["ingest"] = st["last"]
    f["ingest_running"] = st["running"]
    f["ingest_interval_min"] = config.INGEST_INTERVAL_MIN
    return f

@app.get("/api/news/{news_id}")
def get_news(news_id: str, s: Session = Depends(session)):
    n = news.get(news_id)
    if not n or (n.get("user_uid") and n["user_uid"] != s.uid):
        raise HTTPException(404, "Новость не найдена")
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

@app.get("/api/insight/{news_id}")
def get_insight(news_id: str, s: Session = Depends(session)):
    r = agent.cached(s.uid, s.role, news_id)
    # нет кэша — отдаём cached=false, клиент сам запустит прогон
    return r or {"cached": False}

@app.get("/api/insight/{news_id}/stream")
def stream_insight(news_id: str, force: bool = False, s: Session = Depends(session)):
    n = news.get(news_id)
    if not n or (n.get("user_uid") and n["user_uid"] != s.uid):
        raise HTTPException(404, "Новость не найдена")
    if force or not agent.cached(s.uid, s.role, news_id):
        limit(s, "insight")
    return sse(agent.start_insight(s.uid, s.role, news_id, force=force))

class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    news_id: str | None = None
    helper: str | None = Field(default=None, max_length=40)

@app.post("/api/chat")
def chat(body: ChatIn, s: Session = Depends(session)):
    limit(s, "chat")
    helper = None
    if body.helper:
        helper = next((m for m in team.get(s.uid, s.role)["members"] if m["id"] == body.helper), None)
    return sse(agent.start_chat(s.uid, s.role, body.message, body.news_id, helper))

@app.get("/api/chat")
def chat_history(helper: str = "", s: Session = Depends(session)):
    return {"items": agent.chat_history(s.uid, s.role, helper or None)}

@app.delete("/api/chat")
def chat_clear(helper: str = "", s: Session = Depends(session)):
    agent.chat_clear(s.uid, s.role, helper or None)
    return {"ok": True}

@app.get("/api/runs/{run_id}/trace")
def run_trace(run_id: str, s: Session = Depends(session)):
    t = agent.trace(run_id)
    if not t or t["uid"] != s.uid:
        raise HTTPException(404, "Запуск не найден")
    return t

class FeedbackIn(BaseModel):
    news_id: str
    kind: str = Field(pattern="^(useful|not_relevant|undo|rating|expert|action)$")
    value: int = 0
    comment: str = Field(default="", max_length=1000)

@app.post("/api/feedback")
def feedback(body: FeedbackIn, s: Session = Depends(session)):
    db.ex("INSERT INTO feedback(ts,uid,role,news_id,kind,value,comment) VALUES(?,?,?,?,?,?,?)",
          (datetime.now(timezone.utc).isoformat(), s.uid, s.role, body.news_id, body.kind, body.value, security.mask_pii(body.comment)[0]))
    weights = None
    if body.kind == "undo":
        # «вернуть»: снимаем последнее «не про нас» и откатываем веса
        last = db.q1("SELECT id FROM feedback WHERE uid=? AND role=? AND news_id=? AND kind='not_relevant' ORDER BY id DESC LIMIT 1",
                     (s.uid, s.role, body.news_id))
        if last:
            db.ex("DELETE FROM feedback WHERE id=?", (last["id"],))
            sc = ranking.reasons_for(s.uid, s.role, body.news_id) or {}
            keys = ([f"factor:{sc['main']}"] if sc.get("main") else []) + [f"sector:{x}" for x in sc.get("sectors", [])[:2]]
            weights = ranking.apply_feedback(s.uid, s.role, keys, 0.2)
        return {"ok": True, "weights": weights}
    if body.kind in ("useful", "not_relevant"):
        sc = ranking.reasons_for(s.uid, s.role, body.news_id) or {}
        keys = [f"factor:{sc['main']}"] if sc.get("main") else []
        keys += [f"sector:{x}" for x in sc.get("sectors", [])[:2]]
        weights = ranking.apply_feedback(s.uid, s.role, keys, 0.15 if body.kind == "useful" else -0.2)
    return {"ok": True, "weights": weights}

@app.get("/api/kb/docs")
def kb_docs():
    return {"items": kb.docs()}

@app.get("/api/kb/docs/{doc_id}")
def kb_doc(doc_id: str):
    d = kb.doc(doc_id)
    if not d:
        raise HTTPException(404, "Документ не найден")
    return d

@app.get("/api/kb/chunks/{chunk_id}")
def kb_chunk(chunk_id: str):
    c = kb.chunk(chunk_id)
    if not c:
        raise HTTPException(404, "Фрагмент не найден")
    return c

@app.get("/api/kb/pdf/{doc_id}")
def kb_pdf(doc_id: str):
    d = db.q1("SELECT file FROM kb_docs WHERE id=?", (doc_id,))
    path = (config.PDF_DIR / d["file"]) if d else None
    if not path or not path.exists():
        raise HTTPException(404, "PDF не найден")
    return FileResponse(path, media_type="application/pdf", headers={"Content-Disposition": "inline"})

@app.get("/api/metrics")
def get_metrics(s: Session = Depends(session)):
    return metrics.all_metrics()

@app.get("/api/ingest/state")
def ingest_state():
    return news.state()

@app.post("/api/ingest/run")
def ingest_run(s: Session = Depends(session)):
    limit(s, "ingest")
    if news.state()["running"]:
        return {"status": "busy"}
    threading.Thread(target=news.ingest, daemon=True).start()
    return {"status": "started"}

# фронтенд монтируем последним: всё, что не /api и не /docs, идёт из web/
if config.WEB_DIR.exists():
    app.mount("/", StaticFiles(directory=config.WEB_DIR, html=True), name="web")
