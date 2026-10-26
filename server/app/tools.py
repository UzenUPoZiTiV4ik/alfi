"""инструменты агента: схемы, проверка роли, валидация аргументов, аудит.

каждый инструмент возвращает {"summary", "items"}; id из items это единственное,
на что модель может ссылаться в sources.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Callable

from . import db, exa, news, profile, search
from .profile import bn
from .security import allowed, wrap_untrusted
from .taxonomy import FACTORS, SECTORS

SCHEMAS: dict[str, dict] = {
    "get_company_profile": {"description": "Бизнес-контекст компании клиента: признаки, продукты, ВЭД, регион, позиция в отрасли, главные каналы влияния.",
                            "parameters": {"type": "object", "properties": {}, "required": []}},
    "get_counterparties": {"description": "Крупнейшие поставщики или покупатели компании по платежам: доли, отрасли, концентрация, признак ключевого собственника, клиент ли банка.",
                           "parameters": {"type": "object", "properties": {"side": {"type": "string", "enum": ["suppliers", "customers"]},
                                                                           "top": {"type": "integer", "minimum": 1, "maximum": 10}}, "required": ["side"]}},
    "get_group_structure": {"description": "Группа компаний клиента: состав, выручка, отрасли и их доли.",
                            "parameters": {"type": "object", "properties": {}, "required": []}},
    "get_linked_companies": {"description": "Компании, связанные с клиентом через общих физлиц.",
                             "parameters": {"type": "object", "properties": {}, "required": []}},
    "search_news": {"description": "Поиск по собранным новостям (RSS и Exa) за последние дни.",
                    "parameters": {"type": "object", "properties": {"query": {"type": "string", "minLength": 3, "maxLength": 200},
                                                                    "days": {"type": "integer", "minimum": 1, "maximum": 30}}, "required": ["query"]}},
    "get_news": {"description": "Полный текст новости по id и другие источники того же события.",
                 "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
    "search_bank_analytics": {"description": "Поиск по аналитике Альфа-Банка: тезисы с цитатами и страницами, прогнозы, абзацы. Позиция банка берётся только отсюда.",
                              "parameters": {"type": "object", "properties": {"query": {"type": "string", "minLength": 3, "maxLength": 200},
                                                                              "factors": {"type": "array", "items": {"type": "string", "enum": list(FACTORS)}},
                                                                              "sectors": {"type": "array", "items": {"type": "string", "enum": list(SECTORS)}}},
                                             "required": ["query"]}},
    "get_bank_forecasts": {"description": "Прогнозы Альфа-Банка по показателю (ставка, инфляция, курс, ВВП и т.п.).",
                           "parameters": {"type": "object", "properties": {"indicator": {"type": "string", "minLength": 2, "maxLength": 80}}, "required": ["indicator"]}},
    "web_search": {"description": "Поиск в интернете через Exa, когда в новостях мало деталей. Не больше двух раз за разбор.",
                   "parameters": {"type": "object", "properties": {"query": {"type": "string", "minLength": 3, "maxLength": 200}}, "required": ["query"]}},
    "fetch_page": {"description": "Текст страницы по URL (Exa contents), чтобы прочитать первоисточник целиком.",
                   "parameters": {"type": "object", "properties": {"url": {"type": "string", "minLength": 8, "maxLength": 500}}, "required": ["url"]}},
}

class ToolError(ValueError):
    pass

def schemas_for(role: str) -> list[dict]:
    return [{"type": "function", "function": {"name": n, **s}} for n, s in SCHEMAS.items() if allowed(role, n)]

def validate(name: str, args: Any) -> dict:
    if name not in SCHEMAS:
        raise ToolError(f"неизвестный инструмент {name}")
    if not isinstance(args, dict):
        raise ToolError("аргументы должны быть объектом")
    sch = SCHEMAS[name]["parameters"]
    props = sch.get("properties", {})
    out = {}
    for k in sch.get("required", []):
        if k not in args or args[k] in (None, ""):
            raise ToolError(f"{name}: нет аргумента {k}")
    for k, v in args.items():
        if k not in props:
            continue  # лишние аргументы молча отбрасываем
        p = props[k]
        t = p.get("type")
        if t == "string":
            v = str(v).strip()
            if len(v) < p.get("minLength", 0):
                raise ToolError(f"{name}.{k}: слишком коротко")
            v = v[: p.get("maxLength", 500)]
            if "enum" in p and v not in p["enum"]:
                raise ToolError(f"{name}.{k}: недопустимое значение")
        elif t == "integer":
            try:
                v = int(v)
            except (TypeError, ValueError) as e:
                raise ToolError(f"{name}.{k}: нужно число") from e
            v = max(p.get("minimum", v), min(p.get("maximum", v), v))
        elif t == "array":
            v = [x for x in (v if isinstance(v, list) else [v]) if x in p["items"].get("enum", [x])][:6]
        out[k] = v
    return out

def _profile(ctx: dict, a: dict) -> dict:
    p = profile.build(ctx["uid"])
    items = [{"id": f["id"], "kind": "feat", "title": f["label"], "text": f["value"]} for f in p["features"]]
    top = sorted(p["sensitivities"].values(), key=lambda s: -s["value"])[:6]
    items.append({"id": "data:channels", "kind": "data", "title": "Главные каналы влияния",
                  "text": "; ".join(f"{s['label']}: " + ", ".join(w["text"] for w in s["why"][:2]) for s in top)})
    items.append({"id": "data:position", "kind": "data", "title": "Позиция в отрасли (выборка банка)",
                  "text": f"#{p['position']['sector']['rank']} из {p['position']['sector']['of']} в отрасли, доля {p['position']['sector']['share']:.1%} выручки выборки. {p['position']['note']}"})
    return {"summary": profile.brief(p, 6), "items": items}

def _counterparties(ctx: dict, a: dict) -> dict:
    p = profile.build(ctx["uid"])
    side = p[a["side"]]
    name = "поставщики" if a["side"] == "suppliers" else "покупатели"
    top = side["top"][: a.get("top", 5)]
    lines = [f"{t['uid']}: {t['sector_label']}, {t['okved'] or 'нет в базе'}, {bn(t['amount'])} ({t['share']:.0%})"
             + (", клиент банка" if t["client"] else "") + (", есть ключевой собственник" if t["key_owner"] else "") for t in top]
    text = (f"Всего {side['n']} контрагентов, оборот {bn(side['total'])}, внутри группы {bn(side['intra_group'])}. Крупнейший {side['top_share']:.0%}, HHI {side['hhi']}. "
            f"Отрасли: " + ", ".join(f"{s['label']} {s['share']:.0%}" for s in side["sectors"][:4]) +
            f". С ключевым собственником {side['key_owner_share']:.0%}, клиенты банка {side['bank_clients_share']:.0%}. Крупнейшие: " + "; ".join(lines))
    did = f"data:{a['side']}"
    return {"summary": f"{name.capitalize()}: {text}", "items": [{"id": did, "kind": "data", "title": f"Платежи: {name}", "text": text}]}

def _group(ctx: dict, a: dict) -> dict:
    g = profile.build(ctx["uid"])["group"]
    if g["n"] <= 1:
        text = "Компания не входит в группу: в данных одна компания."
    else:
        text = (f"Группа {g['id']}: {g['n']} компаний, суммарная выручка {bn(g['revenue'])}. Отрасли: " +
                ", ".join(f"{s['label']} {s['share']:.0%}" for s in g["sectors"]) + ". Крупнейшие: " +
                "; ".join(f"{m['uid']} {m['sector_label']} {bn(m['revenue'])}" for m in g["members"][:6]))
    return {"summary": text, "items": [{"id": "data:group", "kind": "data", "title": "Группа компаний", "text": text}]}

def _links(ctx: dict, a: dict) -> dict:
    lk = profile.build(ctx["uid"])["links"]
    text = (f"Связанных физлиц: {lk['persons']}. Компании через общих физлиц: " +
            ("; ".join(f"{c['uid']} ({SECTORS.get(c['sector'], {}).get('label', '—')}, {bn(c['revenue'])}, общих лиц {c['shared']})" for c in lk["companies"][:6]) or "нет"))
    return {"summary": text, "items": [{"id": "data:links", "kind": "data", "title": "Связи через физлиц", "text": text}]}

def _search_news(ctx: dict, a: dict) -> dict:
    res = search.search_news(a["query"], k=6, days=a.get("days", 14), exclude=ctx.get("exclude_news"), uid=ctx["uid"])
    items = [{"id": r["id"], "kind": "news", "title": r["title"], "text": r["text"][:500], "source": r["source"],
              "published": r["published"]} for r in res]
    return {"summary": f"Найдено {len(items)} новостей по «{a['query']}»", "items": items}

def _get_news(ctx: dict, a: dict) -> dict:
    i = a["id"].removeprefix("news:")
    n = news.get(i)
    if not n or (n.get("user_uid") and n["user_uid"] != ctx["uid"]):
        raise ToolError("новость не найдена")
    items = [{"id": f"news:{n['id']}", "kind": "news", "title": n["title"], "text": (n["text"] or "")[:2500], "source": n["source"],
              "published": n["published"], "url": n["url"]}]
    for c in n["cluster"][:4]:
        full = db.q1("SELECT text FROM news WHERE id=?", (c["id"],))
        items.append({"id": f"news:{c['id']}", "kind": "news", "title": c["title"], "text": (full["text"] or "")[:800],
                      "source": c["source"], "published": c["published"], "url": c["url"]})
    return {"summary": f"Новость и ещё {len(items) - 1} источников того же события", "items": items}

def _bank(ctx: dict, a: dict) -> dict:
    res = search.search_kb(a["query"], k=7, factors=a.get("factors"), sectors=a.get("sectors"))
    items = [{"id": r["id"], "kind": "bank", "title": f"{r['doc_title']} ({r['doc_date']}), стр. {r['page']}" + (" [устаревший]" if r["stale"] else ""),
              "text": r["text"] + (f" Цитата: «{r['quote']}»" if r.get("quote") else ""), "doc_id": r["doc_id"], "page": r["page"],
              "quote": r.get("quote"), "verified": r.get("quote_verified"), "stale": r["stale"], "url": r["url"],
              "chunk_kind": r["kind"], "factors": r["factors"], "sectors": r["sectors"]} for r in res]
    return {"summary": f"Найдено {len(items)} фрагментов аналитики банка", "items": items}

def _forecasts(ctx: dict, a: dict) -> dict:
    res = search.search_kb(a["indicator"] + " прогноз", k=6, kinds=("forecast", "thesis"), allow_stale=False)
    items = [{"id": r["id"], "kind": "bank", "title": f"{r['doc_title']} ({r['doc_date']}), стр. {r['page']}", "text": r["text"],
              "doc_id": r["doc_id"], "page": r["page"], "quote": r.get("quote"), "verified": r.get("quote_verified"),
              "stale": r["stale"], "url": r["url"], "chunk_kind": r["kind"], "factors": r["factors"], "sectors": r["sectors"]} for r in res]
    return {"summary": f"Прогнозы банка: {len(items)}", "items": items}

def _web(ctx: dict, a: dict) -> dict:
    if ctx.get("web_calls", 0) >= ctx.get("web_limit", 2):
        raise ToolError("лимит web_search на разбор исчерпан")
    ctx["web_calls"] = ctx.get("web_calls", 0) + 1
    res = exa.search(a["query"], num=5, text_chars=1200, ttl_h=12)
    items = []
    for i, r in enumerate(res):
        if not r["url"]:
            continue
        items.append({"id": f"web:{news.nid(r['url'])}", "kind": "web", "title": news.clean_title(r["title"]),
                      "text": news.clean_text(r["text"])[:900], "url": r["url"], "source": news.source_of_url(r["url"])[1],
                      "published": r["published"]})
    return {"summary": f"Exa: {len(items)} страниц по «{a['query']}»", "items": items}

def _fetch(ctx: dict, a: dict) -> dict:
    url = a["url"]
    if not url.startswith(("http://", "https://")):
        raise ToolError("нужен http(s) URL")
    res = exa.contents([url], chars=4000)
    items = [{"id": f"web:{news.nid(r['url'] or url)}", "kind": "web", "title": news.clean_title(r["title"]),
              "text": news.clean_text(r["text"])[:3500], "url": r["url"] or url, "source": news.source_of_url(url)[1]} for r in res]
    return {"summary": f"Страница прочитана: {len(items[0]['text']) if items else 0} символов", "items": items}

IMPL: dict[str, Callable[[dict, dict], dict]] = {
    "get_company_profile": _profile, "get_counterparties": _counterparties, "get_group_structure": _group,
    "get_linked_companies": _links, "search_news": _search_news, "get_news": _get_news, "search_bank_analytics": _bank,
    "get_bank_forecasts": _forecasts, "web_search": _web, "fetch_page": _fetch,
}

def call(name: str, args: Any, ctx: dict) -> dict:
    """Единая точка вызова: RBAC -> валидация -> исполнение -> аудит."""
    t0 = time.time()
    ok, err, out = False, "", {"summary": "", "items": []}
    try:
        if not allowed(ctx["role"], name):
            raise ToolError(f"роль {ctx['role']} не имеет доступа к {name}")
        a = validate(name, args or {})
        out = IMPL[name](ctx, a)
        ok = True
        return out
    except ToolError as e:
        err = str(e)
        raise
    except Exception as e:  # noqa: BLE001 сбой внешнего сервиса не роняет разбор
        err = f"{type(e).__name__}: {e}"
        raise ToolError(err) from e
    finally:
        db.ex("INSERT INTO tool_audit(ts,run_id,uid,role,tool,args_json,ok,ms,error) VALUES(?,?,?,?,?,?,?,?,?)",
              (datetime.now(timezone.utc).isoformat(), ctx.get("run_id"), ctx["uid"], ctx["role"], name, db.j(args or {}),
               int(ok), int((time.time() - t0) * 1000), err[:300]))

def as_text(out: dict, limit: int = 6000) -> str:
    """Результат инструмента для модели: внешние тексты в рамке недоверенных данных."""
    lines = [out["summary"]]
    for it in out["items"]:
        lines.append(f"[{it['id']}] {it.get('title', '')}: {it.get('text', '')}")
    body = "\n".join(lines)[:limit]
    ext = any(it["kind"] in ("news", "web") for it in out["items"])
    return wrap_untrusted(body) if ext else body
