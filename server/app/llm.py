"""клиент шлюза моделей: бюджет, повторы, запасная модель, журнал вызовов.

у reasoning-моделей явно выключаем размышления, иначе они тратят токены и возвращают пустой ответ.
"""
from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from . import config, db

_lock = threading.Lock()
_client: httpx.Client | None = None

class BudgetExceeded(RuntimeError):
    pass

class LLMError(RuntimeError):
    pass

def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=httpx.Timeout(config.LLM_TIMEOUT, connect=15))
    return _client

def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def spent_today() -> float:
    r = db.q1("SELECT COALESCE(SUM(cost_rub),0) s FROM llm_calls WHERE day=?", (today(),))
    return float(r["s"]) if r else 0.0

def budget_state() -> dict:
    s = spent_today()
    return {
        "spent_rub": round(s, 3), "soft_rub": config.BUDGET_SOFT_RUB, "hard_rub": config.BUDGET_HARD_RUB,
        "deep_allowed": s < config.BUDGET_SOFT_RUB, "reset": "00:00 UTC",
    }

def _log(purpose: str, model: str, run_id: str | None, usage: dict, ms: int, ok: bool, error: str = "") -> float:
    cost = float(usage.get("cost") or 0.0)
    db.ex(
        "INSERT INTO llm_calls(ts,day,purpose,model,run_id,prompt_tokens,completion_tokens,cost_rub,ms,ok,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (datetime.now(timezone.utc).isoformat(), today(), purpose, model, run_id, usage.get("prompt_tokens", 0),
         usage.get("completion_tokens", 0), cost, ms, int(ok), error[:300]),
    )
    return cost

def chat(
    messages: list[dict],
    *,
    role: str = "agent",
    model: str | None = None,
    purpose: str = "chat",
    run_id: str | None = None,
    max_tokens: int = 1500,
    temperature: float = 0.3,
    json_mode: bool = False,
    tools: list[dict] | None = None,
    timeout: float | None = None,
    deep: bool = False,
    reasoning: bool | None = None,
) -> dict:
    """Один вызов модели. Возвращает {content, tool_calls, usage, cost, model, ms}.

    deep=True: вызов из глубокого разбора, он блокируется мягким порогом бюджета.
    Остальные вызовы блокируются только жёстким порогом.
    """
    if not config.LLM_API_KEY:
        raise LLMError("LLM_API_KEY не задан")
    spent = spent_today()
    if spent >= config.BUDGET_HARD_RUB or (deep and spent >= config.BUDGET_SOFT_RUB):
        raise BudgetExceeded(f"Дневной бюджет исчерпан: {spent:.1f} ₽")

    primary = model or config.MODELS[role]
    chain = [primary] + ([config.MODELS["fallback"]] if primary != config.MODELS["fallback"] and role != "vision" else [])
    last_err = ""
    for mi, m in enumerate(chain):
        if m not in config.ALLOWED_MODELS:
            raise LLMError(f"Модель {m} не из списка кейса")
        body: dict[str, Any] = {
            "model": m, "messages": messages, "max_tokens": max_tokens, "temperature": temperature,
            "reasoning": {"enabled": config.LLM_REASONING if reasoning is None else reasoning},
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        for attempt in range(2):
            t0 = time.time()
            try:
                r = client().post(
                    f"{config.LLM_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
                    json=body, timeout=timeout or config.LLM_TIMEOUT,
                )
                ms = int((time.time() - t0) * 1000)
                if r.status_code >= 500 or r.status_code == 429:
                    last_err = f"{r.status_code} {r.text[:200]}"
                    _log(purpose, m, run_id, {}, ms, False, last_err)
                    time.sleep(1.5 * (attempt + 1))
                    continue
                if r.status_code >= 400:
                    last_err = f"{r.status_code} {r.text[:300]}"
                    _log(purpose, m, run_id, {}, ms, False, last_err)
                    break  # 4xx не лечится повтором, пробуем запасную модель
                d = r.json()
                msg = (d.get("choices") or [{}])[0].get("message") or {}
                usage = d.get("usage") or {}
                content = msg.get("content") or ""
                tcs = msg.get("tool_calls") or []
                if not content.strip() and not tcs:
                    last_err = "пустой ответ"
                    _log(purpose, m, run_id, usage, ms, False, last_err)
                    continue
                cost = _log(purpose, m, run_id, usage, ms, True)
                return {"content": content, "tool_calls": tcs, "usage": usage, "cost": cost, "model": m, "ms": ms,
                        "fallback": mi > 0}
            except (httpx.TimeoutException, httpx.TransportError) as e:
                ms = int((time.time() - t0) * 1000)
                last_err = f"{type(e).__name__}: {e}"
                _log(purpose, m, run_id, {}, ms, False, last_err)
    raise LLMError(f"Модели недоступны: {last_err}")

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)

def parse_json(text: str) -> Any:
    """Терпимый разбор JSON из ответа модели: снимает ```-обёртку, ищет первый объект."""
    t = _FENCE.sub("", (text or "").strip())
    try:
        return json.loads(t)
    except ValueError:
        pass
    start = min([i for i in (t.find("{"), t.find("[")) if i >= 0], default=-1)
    if start < 0:
        raise ValueError("в ответе нет JSON")
    depth, instr, esc = 0, False, False
    for i in range(start, len(t)):
        ch = t[i]
        if instr:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
            if depth == 0:
                return json.loads(t[start:i + 1])
    # ответ обрезан: закрываем скобки, иначе режем до последней запятой
    return repair_truncated(t[start:])

def repair_truncated(s: str) -> Any:
    cur = s
    for _ in range(60):
        try:
            return json.loads(_close(cur))
        except ValueError:
            cut = cur.rstrip().rstrip(",").rfind(",")
            if cut <= 0:
                break
            cur = cur[:cut]
    raise ValueError("не удалось восстановить обрезанный JSON")

def _close(s: str) -> str:
    stack, instr, esc = [], False, False
    for ch in s:
        if instr:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                instr = False
            continue
        if ch == '"':
            instr = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]" and stack:
            stack.pop()
    s = s.rstrip().rstrip(",")
    if instr:
        s += '"'
    return s + "".join(reversed(stack))

def chat_json(messages: list[dict], **kw) -> tuple[Any, dict]:
    """Вызов в JSON-режиме. При невалидном JSON один повтор с напоминанием."""
    kw.setdefault("json_mode", True)
    r = chat(messages, **kw)
    try:
        return parse_json(r["content"]), r
    except ValueError:
        # повтор даст тот же обрыв, поэтому чиним хвост
        if (r["usage"].get("completion_tokens") or 0) >= kw.get("max_tokens", 1500) - 5:
            t = _FENCE.sub("", r["content"].strip())
            i = t.find("{")
            if i >= 0:
                try:
                    out = repair_truncated(t[i:])
                    r["truncated"] = True
                    return out, r
                except ValueError:
                    pass
        r2 = chat(messages + [{"role": "assistant", "content": r["content"][:2000]},
                              {"role": "user", "content": "Ответ не является валидным JSON. Верни только JSON по схеме."}], **kw)
        r2["cost"] += r["cost"]
        return parse_json(r2["content"]), r2
