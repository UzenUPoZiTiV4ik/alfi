"""команда помощников под компанию и роль.

правила дают кандидатов и веса, модель выбирает до трёх и пишет каждому задачу.
"""
from __future__ import annotations

import re
import threading

from . import db, nlp, profile
from .taxonomy import FACTORS, ROLES, count_hits, sector_label

MAX_TEAM = 4
AUTO_TEAM = 3

# Цвета шерсти по виду помощника (маскот регистрирует цвет на лету)
FUR = {"money": "#2A2A30", "ved": "#F2B33D", "tax": "#E4E2DC", "law": "#6A7275", "people": "#16C8D2",
       "market": "#7A3FE0", "partners": "#4FA35A", "own": "#EF3124"}

# Отраслевой помощник: имя, за чем следит, ключевые факторы
SECTOR_HELPER = {
    "agro": ("Зерно", "Урожай, экспортные цены, пошлины", ["agro", "trade", "logistics"]),
    "food": ("Продукты", "Сырьё, цены на полке, спрос", ["agro", "demand", "inflation"]),
    "beverages": ("Напитки", "Акцизы, сырьё, спрос", ["tax", "demand", "regulation"]),
    "retail": ("Покупатели", "Спрос, доходы, маркетплейсы", ["demand", "inflation", "labor"]),
    "wholesale": ("Рынок", "Спрос, импорт, цены поставщиков", ["demand", "trade", "fx"]),
    "construction": ("Стройка", "Ипотека, спрос на жильё, госзаказ", ["realty", "budget", "rate"]),
    "materials": ("Стройрынок", "Спрос на материалы, энергия", ["realty", "energy", "logistics"]),
    "metals": ("Металлы", "Цены на металлы, экспорт", ["metals", "trade", "fx"]),
    "fuel": ("Топливо", "Нефть, биржевые цены, демпфер", ["oil", "tax", "regulation"]),
    "energy": ("Энергия", "Тарифы, генерация, регулирование", ["energy", "regulation", "budget"]),
    "chemicals": ("Химия", "Сырьё, экспорт, энергия", ["oil", "trade", "energy"]),
    "pharma": ("Фарма", "Регулирование, импорт, госзакупки", ["regulation", "trade", "budget"]),
    "machinery": ("Заказы", "Госзаказ, металл, импортозамещение", ["budget", "metals", "trade"]),
    "auto": ("Авторынок", "Импорт, утильсбор, спрос", ["trade", "demand", "regulation"]),
    "electronics": ("Импорт", "Поставки, курс, спрос", ["trade", "fx", "demand"]),
    "it": ("Цифра", "Льготы, госзаказ, кадры", ["tax", "budget", "labor"]),
    "logistics": ("Логистика", "Тарифы, маршруты, топливо", ["logistics", "oil", "trade"]),
    "finance": ("Финрынок", "Ставка, кредитный риск", ["rate", "credit", "regulation"]),
    "services": ("Спрос", "Клиенты, цены, кадры", ["demand", "labor", "inflation"]),
}

def _w(p: dict, role: str, factors: list[str]) -> float:
    boost = ROLES.get(role, ROLES["cfo"])["boost"]
    vals = sorted((p["sensitivities"][f]["value"] * boost.get(f, 1.0) for f in factors if f in p["sensitivities"]), reverse=True)
    return round(sum(v * k for v, k in zip(vals, (1.0, 0.5, 0.3))), 3)

def _why(p: dict, factors: list[str]) -> str:
    out = []
    for f in factors:
        s = p["sensitivities"].get(f)
        if s and s["why"]:
            w = next((x for x in s["why"] if x["feat"] != "feat:sector"), s["why"][0])
            if w["text"] not in out:
                out.append(w["text"])
    return "; ".join(out[:2])

def candidates(uid: str, role: str) -> list[dict]:
    p = profile.build(uid)
    sec = p["sector"]
    out = []
    name, watch, fs = SECTOR_HELPER.get(sec, SECTOR_HELPER["services"])
    out.append({"id": f"sector-{sec}", "kind": "market", "name": name, "watch": watch, "factors": fs, "sectors": [sec],
                "why": f"основная отрасль «{sector_label(sec)}»" + (f"; {_why(p, fs[1:])}" if _why(p, fs[1:]) else "")})
    has_loan = "Кредиты" in p["products"] or "Лизинг" in p["products"]
    money_watch = "Ставка ЦБ, стоимость кредитов, курс" if has_loan else "Ставка, доход на остатки, курс"
    out.append({"id": "money", "kind": "money", "name": "Деньги", "watch": money_watch, "factors": ["rate", "credit", "inflation"],
                "sectors": [], "why": _why(p, ["rate", "credit"]) or "стоимость денег для оборотного капитала"})
    if p["countries"]:
        cs = ", ".join(c.title() for c in p["countries"][:3])
        out.append({"id": "ved", "kind": "ved", "name": "ВЭД", "watch": f"{cs}: курс, санкции, пошлины", "factors": ["trade", "fx", "logistics"],
                    "sectors": [], "countries": p["countries"], "why": f"компания ведёт ВЭД ({cs})"})
    sup, cus = p["suppliers"], p["customers"]
    conc = max(sup["top_share"], cus["top_share"])
    if sup["n"] + cus["n"] >= 3:
        secs = [s["sector"] for s in (sup["sectors"][:2] + cus["sectors"][:2]) if s["share"] >= 0.05 and s["sector"] != sec]
        side = "покупателе" if cus["top_share"] >= sup["top_share"] else "поставщике"
        out.append({"id": "partners", "kind": "partners", "name": "Контрагенты", "watch": "Отрасли поставщиков и покупателей, долги",
                    "factors": ["credit", "logistics", "demand"], "sectors": secs,
                    "why": f"{conc:.0%} оборота на одном {side}" if conc >= 0.3 else f"{sup['n']} поставщиков и {cus['n']} покупателей",
                    "bonus": 0.35 if conc >= 0.5 else 0.1})
    out.append({"id": "tax", "kind": "tax", "name": "Налоги", "watch": "НДС, прибыль, акцизы, пошлины", "factors": ["tax", "budget"],
                "sectors": [], "why": _why(p, ["tax"]) or "изменения налогов"})
    out.append({"id": "law", "kind": "law", "name": "Законы", "watch": "Регулирование отрасли, требования, госзаказ",
                "factors": ["regulation", "budget"], "sectors": [], "why": _why(p, ["regulation", "budget"]) or "регулирование отрасли"})
    if p["group"]["n"] > 1:
        out.append({"id": "group", "kind": "partners", "name": "Группа", "watch": f"{p['group']['n']} компаний группы и их отрасли",
                    "factors": ["demand", "regulation", "credit"], "sectors": [g["sector"] for g in p["group"]["sectors"][1:4]],
                    "why": f"группа из {p['group']['n']} компаний: " + ", ".join(g["label"] for g in p["group"]["sectors"][:3]), "bonus": 0.15})
    if (p["sensitivities"]["labor"]["value"] or 0) >= 0.35:
        out.append({"id": "people", "kind": "people", "name": "Люди", "watch": "Кадры, зарплаты, МРОТ", "factors": ["labor", "inflation"],
                    "sectors": [], "why": _why(p, ["labor"])})
    for c in out:
        c["weight"] = round(_w(p, role, c["factors"]) + c.pop("bonus", 0) + (0.4 if c["id"].startswith("sector-") else 0), 3)
        c["fur"] = FUR[c["kind"]]
        c["auto"] = True
    out.sort(key=lambda c: -c["weight"])
    return out

def _key(uid: str, role: str) -> str:
    return f"team:{uid}|{role}"

def get(uid: str, role: str) -> dict:
    cands = candidates(uid, role)
    by = {c["id"]: c for c in cands}
    ai = db.kv_get(_ai_key(uid, role))
    if ai:
        for c in cands:
            x = ai["notes"].get(c["id"])
            if x:
                c["task"], c["why_ai"] = x.get("task", ""), x.get("why", "")
    saved = db.kv_get(_key(uid, role))
    if saved:
        members = [by[i] for i in saved.get("ids", []) if i in by] + [own_view(o) for o in saved.get("own", [])]
        picked_by = "custom"
    elif ai and ai.get("ids") and all(i in by for i in ai["ids"]):
        members, picked_by = [by[i] for i in ai["ids"]], "ai"
    else:
        members, picked_by = cands[:AUTO_TEAM], "rules"
    members = members[:MAX_TEAM]
    ids = {m["id"] for m in members}
    return {"members": members, "available": [c for c in cands if c["id"] not in ids], "max": MAX_TEAM, "custom": bool(saved),
            "picked_by": picked_by, "selecting": _ai_busy(uid, role), "ai": {"model": ai.get("model"), "summary": ai.get("summary", ""),
            "skipped": ai.get("skipped", {})} if ai else None}

# ---------- Подбор команды моделью ----------
# Правила дают кандидатов и веса, модель выбирает троих под задачи компании и роль и пишет каждому конкретную задачу.
# кэш на компанию и роль; если модель недоступна, остаётся подбор правилами
TEAM_PROMPT = """Ты собираешь команду помощников-аналитиков для руководителя крупной компании в интернет-банке Альфа-Бизнес.
Каждый помощник следит за своей темой в новостях и объясняет влияние на бизнес. Выбери ровно {n} помощников из кандидатов,
которые дадут этой компании и роли «{role}» (фокус: {focus}) самый полезный сигнал. Не бери помощника, если у компании нет такого риска в данных.
Ответ строго JSON:
{{"summary": "одно предложение, по какому принципу собрана команда",
  "team": [{{"id": "id кандидата", "task": "за что отвечает в этой компании, конкретно, до 14 слов", "why": "почему нужен, со ссылкой на данные компании, до 16 слов"}}],
  "skipped": [{{"id": "id кандидата", "why": "почему не нужен сейчас, до 10 слов"}}]}}
Пиши по-русски, без воды, опирайся только на профиль и кандидатов."""

def _ai_key(uid: str, role: str) -> str:
    return f"team_ai:{uid}|{role}"

_ai_lock = threading.Lock()
_ai_running: set[str] = set()

def _ai_busy(uid: str, role: str) -> bool:
    with _ai_lock:
        return _ai_key(uid, role) in _ai_running

def pick_ai(uid: str, role: str) -> dict | None:
    from . import llm
    p = profile.build(uid)
    if not p:
        return None
    cands = candidates(uid, role)
    rl = ROLES.get(role, ROLES["cfo"])
    lines = "\n".join(f"- id={c['id']}; {c['name']}: {c['watch']}; факторы: {', '.join(FACTORS[f]['label'] for f in c['factors'] if f in FACTORS)}; "
                       f"данные: {c['why']}; вес правил {c['weight']}" for c in cands)
    msgs = [{"role": "system", "content": TEAM_PROMPT.format(n=AUTO_TEAM, role=rl["label"], focus=rl["focus"])},
            {"role": "user", "content": f"Профиль компании:\n{profile.brief(p, 8)}\n\nКандидаты:\n{lines}"}]
    out, r = llm.chat_json(msgs, role="agent", purpose="team", max_tokens=900, temperature=0.2)
    by = {c["id"]: c for c in cands}
    team = [t for t in (out.get("team") or []) if isinstance(t, dict) and t.get("id") in by]
    ids = list(dict.fromkeys(t["id"] for t in team))[:AUTO_TEAM]
    if len(ids) < min(AUTO_TEAM, len(cands)):
        # модель дала меньше трёх — добираем по правилам
        ids += [c["id"] for c in cands if c["id"] not in ids][:AUTO_TEAM - len(ids)]
    notes = {t["id"]: {"task": str(t.get("task", ""))[:160], "why": str(t.get("why", ""))[:180]} for t in team}
    skipped = {x["id"]: str(x.get("why", ""))[:120] for x in (out.get("skipped") or []) if isinstance(x, dict) and x.get("id") in by}
    res = {"ids": ids, "notes": notes, "skipped": skipped, "summary": str(out.get("summary", ""))[:240], "model": r.get("model")}
    db.kv_set(_ai_key(uid, role), res)
    return res

def ensure_ai(uid: str, role: str) -> None:
    """Запустить подбор в фоне, если для компании и роли его ещё не было."""
    key = _ai_key(uid, role)
    if db.kv_get(key):
        return
    with _ai_lock:
        if key in _ai_running:
            return
        _ai_running.add(key)

    def go():
        try:
            pick_ai(uid, role)
        except Exception as e:  # noqa: BLE001 остаётся подбор правилами
            db.kv_set(key, {"ids": [], "notes": {}, "skipped": {}, "summary": "", "model": None, "error": str(e)[:200]})
        finally:
            with _ai_lock:
                _ai_running.discard(key)

    threading.Thread(target=go, daemon=True).start()

def own_view(o: dict) -> dict:
    return {"id": o["id"], "kind": "own", "name": o["name"], "watch": o["watch"], "fur": o["fur"], "factors": o.get("factors", []),
            "sectors": [], "keywords": o.get("keywords", []), "why": "своя тема", "auto": False, "weight": 0}

_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")

def save(uid: str, role: str, ids: list[str], own: list[dict]) -> dict:
    cands = {c["id"] for c in candidates(uid, role)}
    ids = [i for i in dict.fromkeys(ids) if i in cands]
    clean = []
    for o in own[:2]:
        name = re.sub(r"\s+", " ", str(o.get("name", ""))).strip()[:18]
        watch = re.sub(r"\s+", " ", str(o.get("watch", ""))).strip()[:60]
        if not name or not watch:
            continue
        fur = str(o.get("fur", "")).upper() if _HEX.match(str(o.get("fur", ""))) else FUR["own"]
        raw = str(o.get("id", "")).lower()
        oid = raw if re.match(r"^own-[a-z0-9]{1,12}$", raw) else "own-" + (re.sub(r"[^a-z0-9]", "", raw)[-10:] or "x")
        # свою тему разбираем по словам: факторы и ключи для поиска
        facs = [f for f, v in FACTORS.items() if count_hits(watch + " " + name, v["words"])][:3]
        kws = [s for s in nlp.stems(watch) if len(s) >= 4][:6]
        clean.append({"id": oid, "name": name, "watch": watch, "fur": fur, "factors": facs, "keywords": kws})
    if len(ids) + len(clean) > MAX_TEAM:
        ids = ids[: MAX_TEAM - len(clean)]
    if not ids and not clean:
        db.kv_del(_key(uid, role))
    else:
        db.kv_set(_key(uid, role), {"ids": ids, "own": clean})
    return get(uid, role)

def assign(card: dict, members: list[dict]) -> str | None:
    """Чей это сигнал: помощник с наибольшим совпадением факторов, отраслей, стран или своих слов."""
    fac = [f["id"] for f in card["factors"]]
    secs = {s["id"] for s in card["sectors"]}
    text_st = None
    best, bs = None, 0.0
    for m in members:
        s = 0.0
        for i, f in enumerate(fac):
            if f in m["factors"]:
                s += (1.0, 0.6, 0.35)[min(i, 2)] * (1.0 if m["factors"].index(f) == 0 else 0.8)
        if secs & set(m.get("sectors") or []):
            s += 0.5
        if m.get("countries") and any(r["feat"] == "feat:fts" for r in card["reasons"]):
            s += 0.6
        if m.get("keywords"):
            if text_st is None:
                text_st = set(nlp.stems(f"{card['title']} {card['lead']}"))
            hit = sum(1 for k in m["keywords"] if any(t.startswith(k[:5]) for t in text_st))
            s += 0.9 * hit
        if s > bs:
            best, bs = m["id"], s
    return best if bs >= 0.5 else None
