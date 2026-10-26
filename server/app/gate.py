"""необязательный вход на сайт: своя форма вместо basic auth.

пароль задаётся в SITE_PASSWORD, если он нужен. после входа браузер получает
подписанную куку, без неё все страницы уводят на форму, а api отвечает 401.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from . import config

COOKIE = "alfi_gate"
OPEN_PATHS = {"/gate", "/gate.css", "/api/gate", "/gate-cat.png"}

_hits: dict[str, deque] = defaultdict(deque)
_lock = Lock()
LIMIT, WINDOW = 6, 300      # 6 попыток за 5 минут
BLOCK = 900                  # потом на 15 минут


def _sign(body: str) -> str:
    return hmac.new(config.SITE_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()[:40]


def issue() -> str:
    body = base64.urlsafe_b64encode(str(int(time.time()) + config.SITE_COOKIE_TTL_H * 3600).encode()).decode().rstrip("=")
    return f"{body}.{_sign(body)}"


def check(token: str | None) -> bool:
    if not token or "." not in token:
        return False
    body, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(body)):
        return False
    try:
        exp = int(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except ValueError:
        return False
    return exp > time.time()


def api_only(request: Request) -> bool:
    path = request.url.path
    return path.startswith("/api/") or path == "/openapi.json"


def may_pass(request: Request) -> bool:
    if request.url.path in OPEN_PATHS:
        return True
    if check(request.cookies.get(COOKIE)):
        return True
    # healthcheck контейнера и systemd ходит с самого хоста
    host = request.client.host if request.client else ""
    return host in ("127.0.0.1", "::1") and request.url.path == "/api/health"


def wrong_password(ip: str) -> bool:
    now = time.time()
    with _lock:
        q = _hits[ip]
        while q and q[0] < now - WINDOW:
            q.popleft()
        if len(q) >= LIMIT:
            return True
        q.append(now)
        return False


def blocked(ip: str) -> float:
    with _lock:
        q = _hits[ip]
        if len(q) >= LIMIT and q and time.time() - q[-1] < BLOCK:
            return round(BLOCK - (time.time() - q[-1]))
    return 0


def guard(request: Request):
    """None — пускаем, иначе готовый ответ."""
    if may_pass(request):
        return None
    if api_only(request):
        return JSONResponse({"detail": "нужен вход на сайт"}, status_code=401)
    return RedirectResponse(config.SITE_BASE + "/gate", status_code=302)


def login(request: Request, password: str) -> JSONResponse | RedirectResponse:
    ip = request.client.host if request.client else "?"
    left = blocked(ip)
    if left:
        return JSONResponse({"detail": f"слишком много попыток, подождите {left // 60 + 1} мин"}, status_code=429)
    ok = bool(config.SITE_PASSWORD) and hmac.compare_digest(password or "", config.SITE_PASSWORD)
    if not ok:
        wrong_password(ip)
        return RedirectResponse(config.SITE_BASE + "/gate?e=1", status_code=303)
    resp = RedirectResponse(config.SITE_BASE + "/", status_code=303)
    resp.set_cookie(
        COOKIE, issue(), max_age=config.SITE_COOKIE_TTL_H * 3600, path=config.SITE_BASE or "/",
        httponly=True, samesite="lax", secure=bool(config.SITE_BASE),
    )
    return resp


def page(error: bool = False) -> HTMLResponse:
    err = '<div class="err">Неверный пароль. Попробуйте ещё раз.</div>' if error else ""
    return HTMLResponse(GATE_HTML.replace("__ERR__", err))


GATE_HTML = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Вход · Альфи</title>
<link rel="stylesheet" href="gate.css">
</head>
<body>
<div class="wrap">
  <div class="art">
    <span class="k">Альфа Хак · новостная аналитика</span>
    <img src="gate-cat.png" alt="Альфи" width="320" height="320">
  </div>
  <div class="form">
    <div class="brand"><i>А</i>Альфа-Бизнес</div>
    <h1>Альфи ждёт вас</h1>
    <p>демо для жюри</p>
    <form method="post" action="api/gate">
      <label for="p">Пароль</label>
      <input id="p" name="password" type="password" autocomplete="current-password" required autofocus placeholder="пароль">
      <button type="submit">Войти</button>
    </form>
    __ERR__
    <p class="note">После входа пароль спрашивать не будем неделю.</p>
  </div>
</div>
</body>
</html>"""
