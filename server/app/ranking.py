"""лента: оценка новости, причины попадания, вид, тема, триаж, отклик.

score = base × сила × свежесть × доверие × событие × отклик
base  = 0.55·отрасль + 0.75·фактор + гео
"""
from __future__ import annotations

import math
import threading
import time
from datetime import datetime, timedelta, timezone

from . import config, db, llm, profile, search
from .security import wrap_untrusted
from .taxonomy import AREAS, FACTOR_AREAS, FACTORS, ROLES, SECTORS, SELLER_OF, SOURCE_TRUST, TOPICS, count_hits, sector_label

CHANCE_WORDS = ["снижени ставк", "снизил ставк", "снизит ставк", "субсид", "льгот", "господдержк", "поддержк бизнес", "рост спрос",
                "рекордн урож", "рост экспорт", "отмен пошлин", "снижени пошлин", "упрощени", "снизил пошлин", "открыл рын", "новые рынк",
                "смягчени", "снижени налог", "компенсац", "рост продаж", "госзаказ", "нацпроект"]
RISK_WORDS = ["повышени ставк", "повысил ставк", "санкц", "запрет", "штраф", "дефолт", "банкрот", "паден", "снижени спрос", "рост налог",
              "повышени налог", "ужесточ", "огранич", "дефицит", "убыт", "подорожа", "рост издерж", "просрочк", "ослаблени рубл", "укреплени рубл"]

def now() -> datetime:
    return datetime.now(timezone.utc)

def pkey(uid: str, role: str) -> str:
    return f"{uid}|{role}"

# ---------- Фидбек ----------
def prefs(uid: str, role: str) -> dict[str, float]:
    r = db.q1("SELECT weights_json FROM user_prefs WHERE key=?", (pkey(uid, role),))
    return db.unj(r["weights_json"], {}) if r else {}

def apply_feedback(uid: str, role: str, keys: list[str], delta: float) -> dict:
    w = prefs(uid, role)
    for k in keys:
        w[k] = round(max(0.3, min(1.6, w.get(k, 1.0) + delta)), 3)
    db.ex("INSERT OR REPLACE INTO user_prefs(key,weights_json,updated) VALUES(?,?,?)", (pkey(uid, role), db.j(w), now().isoformat()))
    invalidate_feed(uid)
    return w

# ---------- Скоринг одной новости ----------
def _news_signals(n: dict) -> tuple[dict[str, int], dict[str, int], dict]:
    tags, ext = n["tags"], n.get("extract") or {}
    secs = dict(tags.get("sectors") or {})
    for s in ext.get("sectors") or []:
        secs[s] = secs.get(s, 0) + 2
    facs = dict(tags.get("factors") or {})
    for f in ext.get("factors") or []:
        facs[f["id"]] = facs.get(f["id"], 0) + int(f.get("strength") or 1) + 1
    return secs, facs, ext

def score(n: dict, p: dict, role: str, w: dict[str, float]) -> dict | None:
    secs, facs, ext = _news_signals(n)
    if ext and ext.get("business") is False and not n.get("user_uid"):
        return None
    boost = ROLES.get(role, ROLES["cfo"])["boost"]
    reasons: list[dict] = []

    sector, best_sec = 0.0, None
    for s, hits in secs.items():
        v = p["sector_weights"].get(s, 0) * min(1.0, 0.45 + 0.2 * hits)
        if v > sector:
            sector, best_sec = v, s
    if best_sec:
        if best_sec == p["sector"]:
            reasons.append({"text": f"ваша отрасль: {sector_label(best_sec)}", "feat": "feat:sector", "w": round(sector, 2)})
        else:
            src = next((g for g in p["group"]["sectors"] if g["sector"] == best_sec), None)
            reasons.append({"text": f"{'в группе' if src else 'у контрагентов'} есть «{sector_label(best_sec)}»",
                            "feat": "feat:group" if src else "feat:suppliers", "w": round(sector, 2)})

    contrib: dict[str, float] = {}
    for f, hits in facs.items():
        sens = p["sensitivities"].get(f)
        if not sens:
            continue
        strength = min(1.0, 0.3 + 0.18 * hits)
        contrib[f] = strength * sens["value"] * boost.get(f, 1.0)
    factor = 1 - math.exp(-1.3 * sum(contrib.values()))
    main = max(contrib, key=contrib.get) if contrib else None
    for f in sorted(contrib, key=contrib.get, reverse=True)[:2]:
        if contrib[f] < 0.08:
            continue
        why = p["sensitivities"][f]["why"]
        spec = [x for x in why if x["feat"] != "feat:sector"] or why
        w0 = spec[0] if spec else None
        text = FACTORS[f]["label"] if not w0 or (w0["feat"] == "feat:sector" and best_sec == p["sector"]) else f"{FACTORS[f]['label']}: {w0['text']}"
        reasons.append({"text": text, "feat": w0["feat"] if w0 else "feat:sector", "w": round(contrib[f], 2), "factor": f})

    geo = 0.0
    if p["region_stem"] and p["region_stem"] in (n["tags"].get("regions") or []):
        geo += 0.25
        reasons.append({"text": f"ваш регион: {p['region']}", "feat": "feat:region", "w": 0.25})
    hit_c = [c for c in p["countries"] if c in (n["tags"].get("countries") or [])]
    # страна важна только для торговли, валюты, логистики и своей отрасли
    if hit_c and (set(contrib) & {"trade", "fx", "logistics"} or sector >= 0.6):
        geo += 0.35
        reasons.append({"text": f"страна вашей ВЭД: {', '.join(c.title() for c in hit_c[:3])}", "feat": "feat:fts", "w": 0.35})

    base = 0.55 * sector + 0.75 * factor + geo
    mat = int(ext.get("materiality") or 2)
    materiality = 0.55 + 0.15 * min(5, mat)
    age_h = max(0.0, (now() - datetime.fromisoformat(n["published"])).total_seconds() / 3600) if n.get("published") else 48
    recency = 0.5 + 0.5 * math.exp(-age_h / 72)
    trust = 0.75 + 0.25 * SOURCE_TRUST.get(n["source_id"] or "exa", 0.6)
    cluster = 1 + min(0.3, 0.1 * (n.get("n_sources", 1) - 1))
    fb = 1.0
    for k in {f"factor:{main}"} | {f"sector:{s}" for s in secs} | {r["feat"] for r in reasons}:
        fb *= w.get(k, 1.0)
    fb = max(0.3, min(1.6, fb))
    s = base * materiality * recency * trust * cluster * fb
    return {"score": s, "main": main, "reasons": reasons, "sectors": sorted(secs, key=secs.get, reverse=True)[:3],
            "factors": sorted(contrib, key=contrib.get, reverse=True)[:3], "materiality": mat,
            "parts": {"sector": round(sector, 3), "factor": round(factor, 3), "geo": geo, "materiality": round(materiality, 2),
                      "recency": round(recency, 2), "trust": round(trust, 2), "cluster": round(cluster, 2), "feedback": round(fb, 2)}}

def guess_kind(n: dict, main: str | None) -> str:
    t = f"{n['title']} {(n.get('extract') or {}).get('summary', '')}"
    c, r = count_hits(t, CHANCE_WORDS), count_hits(t, RISK_WORDS)
    return "chance" if c > r else "risk"

def areas_for(factors: list[str], p: dict, reasons: list[dict]) -> list[dict]:
    """Сферы бизнеса по правилам, если триаж ещё не ответил.
    Цена сырья для продавца этого сырья бьёт по выручке, для покупателя по закупкам."""
    out: list[str] = []
    feats = {r["feat"] for r in reasons}
    for f in factors:
        for a in FACTOR_AREAS.get(f, []):
            if a == "costs" and p["sector"] in SELLER_OF.get(f, set()):
                a = "revenue"
            if a == "debt" and not ({"Кредиты", "Лизинг"} & set(p["products"])) and f != "credit":
                a = "liquidity"
            if a == "fx" and not p["countries"]:
                continue
            if a not in out:
                out.append(a)
    if "feat:suppliers" in feats or "feat:customers" in feats:
        out.append("counterparty")
    return [{"id": a, "label": AREAS[a], "effect": "", "impact": None} for a in dict.fromkeys(out)][:4]

# ---------- Кандидаты ----------
def candidates(uid: str, days: int = 5) -> list[dict]:
    since = (now() - timedelta(days=days)).isoformat()
    rows = db.q("""SELECT n.id, n.url, n.title, n.text, n.source, n.source_id, n.origin, n.published, n.cluster_id, n.tags_json,
                          n.extract_json, n.user_uid,
                          (SELECT COUNT(DISTINCT m.source) FROM news m WHERE m.cluster_id = n.id) AS n_sources
                   FROM news n
                   WHERE n.published >= ? AND (n.cluster_id = n.id OR n.cluster_id IS NULL)
                     AND (n.user_uid IS NULL OR n.user_uid = ?)""", (since, uid))
    out = []
    for r in rows:
        r["tags"] = db.unj(r.pop("tags_json"), {}) or {}
        r["extract"] = db.unj(r.pop("extract_json"), None)
        r["n_sources"] = max(1, r["n_sources"] or 1)
        if r["tags"].get("business") or r["user_uid"]:
            out.append(r)
    return out

_stats_cache: tuple[float, dict] | None = None


def corpus_stats(days: int = 5) -> dict:
    """счётчики по всей базе: считаем раз в 5 минут, они меняются только после сбора"""
    global _stats_cache
    if _stats_cache and time.time() - _stats_cache[0] < 300:
        return dict(_stats_cache[1], days=days)
    since = (now() - timedelta(days=days)).isoformat()
    a = db.q1("SELECT COUNT(*) n, COUNT(DISTINCT source) s, COUNT(DISTINCT cluster_id) e FROM news WHERE published >= ?", (since,))
    b = db.q1("SELECT COUNT(*) n FROM news WHERE published >= ? AND cluster_id = id AND tags_json LIKE '%\"business\":true%'", (since,))
    out = {"scanned": a["n"], "sources": a["s"], "events": a["e"], "business": b["n"], "days": days}
    _stats_cache = (time.time(), out)
    return out

# ---------- Лента ----------
# лента пересобирается с sqlite каждый раз, поэтому держим её в памяти на пару десятков секунд
_feed_cache: dict[tuple, tuple[float, dict]] = {}
_feed_lock = threading.Lock()
FEED_TTL_SEC = 180


def invalidate_feed(uid: str | None = None) -> None:
    with _feed_lock:
        if uid is None:
            _feed_cache.clear()
            global _stats_cache
            _stats_cache = None
        else:
            for k in [k for k in _feed_cache if k[0] == uid]:
                _feed_cache.pop(k, None)


def feed(uid: str, role: str, limit: int | None = None, triage_on: bool = True) -> dict:
    ck = (uid, role, limit, triage_on)
    with _feed_lock:
        hit = _feed_cache.get(ck)
        if hit and time.time() - hit[0] < FEED_TTL_SEC:
            return hit[1]
    t0 = now()
    p = profile.build(uid)
    if not p:
        raise KeyError(uid)
    w = prefs(uid, role)
    key = pkey(uid, role)
    tri = {r["news_id"]: db.unj(r["data_json"], {}) for r in db.q("SELECT news_id, data_json FROM triage WHERE key=?", (key,))}
    ins = {r["news_id"] for r in db.q("SELECT news_id FROM insights WHERE key=?", (key,))}
    hidden = {r["news_id"] for r in db.q("SELECT news_id FROM feedback WHERE uid=? AND role=? AND kind='not_relevant'", (uid, role))}
    scored = []
    for n in candidates(uid):
        if n["id"] in hidden:
            continue
        s = score(n, p, role, w)
        if s and (s["score"] >= config.FEED_THRESHOLD or n["user_uid"]):
            scored.append((n, s))
    scored.sort(key=lambda x: -x[1]["score"])
    best = scored[0][1]["score"] if scored else 1.0
    per_main: dict[str, int] = {}
    items = []
    size = limit or config.FEED_SIZE
    for n, s in scored:
        m = s["main"] or "other"
        if n["user_uid"]:
            continue
        if per_main.get(m, 0) >= 4:
            continue
        per_main[m] = per_main.get(m, 0) + 1
        items.append(card(n, s, p, best, tri.get(n["id"]), n["id"] in ins))
        if len(items) >= size:
            break
    # свою новость показываем всегда, иначе непонятно, дочитал ли её сервис
    for n, s in scored:
        if n["user_uid"]:
            items.append(card(n, s, p, best, tri.get(n["id"]), n["id"] in ins))
    from . import team as team_mod
    tm = team_mod.get(uid, role)
    for it in items:
        it["helper"] = team_mod.assign(it, tm["members"])
    # триаж сказал «не касается» — опускаем, но не прячем
    for it in items:
        k = 0.35 if it["relevant"] is False else (1.0 + 0.08 * (it["urgency"] - 2) if it["triaged"] else 1.0)
        it["score"] = round(it["score"] * k, 4)
    items.sort(key=lambda it: -it["score"])
    top = items[0]["score"] if items else 1.0
    for it in items:
        it["relevance"] = round(100 * min(1.0, 0.35 + 0.65 * it["score"] / top)) if top else 0
    pending = [it["id"] for it in items if not it["triaged"]][:24]
    if triage_on and pending and llm.budget_state()["spent_rub"] < config.BUDGET_HARD_RUB:
        start_triage(uid, role, pending)
    st = corpus_stats()
    st["picked"] = len(items)
    out = {"items": items, "stats": st, "triage_pending": bool(pending), "ms": int((now() - t0).total_seconds() * 1000),
           "role": role, "uid": uid, "team": tm}
    with _feed_lock:
        if len(_feed_cache) > 64:
            _feed_cache.clear()
        _feed_cache[ck] = (time.time(), out)
    return out

def card(n: dict, s: dict, p: dict, best: float, t: dict | None, has_insight: bool) -> dict:
    ext = n.get("extract") or {}
    main = s["main"]
    kind = (t or {}).get("kind") or guess_kind(n, main)
    topic = (t or {}).get("topic") or (FACTORS[main]["topic"] if main else "sales")
    if topic not in TOPICS:
        topic = FACTORS[main]["topic"] if main else "sales"
    sec_hit = [x for x in s["sectors"] if x == p["sector"]] or s["sectors"][:1]
    refs = search.bank_refs_for(s["factors"][:2], sec_hit, n["title"] + " " + (ext.get("summary") or ""), k=2)
    why = (t or {}).get("why") or ("Касается вас через: " + "; ".join(r["text"] for r in s["reasons"][:3]) + ".")
    areas = []
    for a in (t or {}).get("areas") or []:
        if isinstance(a, dict) and a.get("id") in AREAS and a["id"] not in {x["id"] for x in areas}:
            areas.append({"id": a["id"], "label": AREAS[a["id"]], "effect": str(a.get("effect") or "")[:120],
                          "impact": a.get("impact") if a.get("impact") in ("positive", "negative", "mixed") else None})
    if not areas:
        areas = areas_for(s["factors"], p, s["reasons"])
    eff = (t or {}).get("effective_date") or ext.get("effective_date") or None
    days = None
    if eff:
        try:
            days = (datetime.fromisoformat(eff[:10]).date() - now().date()).days
        except ValueError:
            eff = None
    return {
        "id": n["id"], "title": n["title"], "headline": (t or {}).get("headline") or n["title"],
        "lead": ext.get("summary") or (n.get("text") or "")[:240], "url": n["url"], "source": n["source"], "source_id": n["source_id"],
        "origin": n["origin"], "published": n["published"], "n_sources": n["n_sources"], "user": bool(n["user_uid"]),
        "kind": kind if kind in ("risk", "chance", "mixed") else "risk", "topic": topic, "main_factor": main,
        "main_factor_label": FACTORS[main]["label"] if main else None,
        "factors": [{"id": f, "label": FACTORS[f]["label"]} for f in s["factors"]],
        "sectors": [{"id": x, "label": SECTORS[x]["label"]} for x in s["sectors"] if x in SECTORS],
        "relevance": round(100 * min(1.0, 0.35 + 0.65 * s["score"] / best)), "score": round(s["score"], 4), "parts": s["parts"],
        "reasons": s["reasons"], "why": why, "urgency": int((t or {}).get("urgency") or (3 if s["materiality"] >= 5 else 2 if s["materiality"] >= 3 else 1)),
        "action": (t or {}).get("action") or "Разобрать влияние на компанию", "effective_date": eff, "days": days,
        "deadline_label": (t or {}).get("deadline_label") or "", "key_facts": ext.get("key_facts") or [],
        "bank_refs": [{"id": r["id"], "doc_id": r["doc_id"], "doc_title": r["doc_title"], "page": r["page"], "text": r["text"],
                       "quote": r["quote"], "verified": r["quote_verified"], "url": r["url"], "date": r["doc_date"]} for r in refs],
        "areas": areas[:4], "relevant": (t or {}).get("relevant") if isinstance((t or {}).get("relevant"), bool) else None,
        "triaged": bool(t), "has_insight": has_insight,
    }

# ---------- Триаж (deepseek, топ-12 за вызов) ----------
_tri_running: set[str] = set()
_tri_tries: dict[str, int] = {}  # сколько раз новость уже отправляли в триаж: не больше двух попыток
_tri_lock = threading.Lock()

TRIAGE_PROMPT = """Ты аналитик Альфа-Банка. Для руководителя компании ({role}, фокус: {focus}) коротко оцени каждую новость.
Не пересказывай новость. Объясни, что она меняет для ЭТОЙ компании, через её конкретный признак (отрасль, кредиты, ВЭД, страны, регион, контрагенты, группа).
Событие почти всегда задевает несколько сфер бизнеса, а не только цену: выручку, закупки, долг, остатки, валютные расчёты,
налоги, логистику, покупателей, контрагентов, персонал, требования регулятора, стратегию. Назови 2-4 затронутые сферы этой компании.
Если событие компанию не касается, поставь relevant=false.
Не упоминай внутренние коэффициенты, баллы и чувствительности. Цифры только из новости. Сегодня {today}.
Сферы (id): {areas}
Профиль компании:
{profile}

Ответ строго JSON: {{"items":[{{"i":номер,"kind":"risk|chance|mixed","topic":"money|tax|sales|law|ved|people",
"headline":"заголовок до 90 символов: что меняется для компании, а не что случилось","why":"1-2 предложения через конкретный признак компании",
"relevant":true|false,"areas":[{{"id":"id сферы","impact":"positive|negative|mixed (хорошо или плохо для компании)","effect":"как именно меняется, до 90 символов"}}],
"urgency":1-3,"action":"первое действие, до 60 символов, глаголом","effective_date":"YYYY-MM-DD если в новости есть срок вступления или дата события, иначе пусто",
"deadline_label":"короткая подпись срока, например 'с 1 января' или пусто"}}]}}"""

def start_triage(uid: str, role: str, ids: list[str]) -> None:
    key = pkey(uid, role)
    with _tri_lock:
        ids = [i for i in ids if _tri_tries.get(f"{key}|{i}", 0) < 2]
        if key in _tri_running or not ids:
            return
        _tri_running.add(key)
        for i in ids:
            _tri_tries[f"{key}|{i}"] = _tri_tries.get(f"{key}|{i}", 0) + 1

    def run():
        from concurrent.futures import ThreadPoolExecutor

        def one(chunk):
            try:
                triage(uid, role, chunk)
            except Exception:  # noqa: BLE001 без триажа лента работает на правилах
                pass
        try:
            with ThreadPoolExecutor(max_workers=2) as ex:
                list(ex.map(one, [ids[i:i + 12] for i in range(0, len(ids), 12)]))
        finally:
            with _tri_lock:
                _tri_running.discard(key)

    threading.Thread(target=run, daemon=True).start()

def triage(uid: str, role: str, ids: list[str]) -> int:
    p = profile.build(uid)
    rows = [db.q1("SELECT id, title, text, source, published, extract_json FROM news WHERE id=?", (i,)) for i in ids]
    rows = [r for r in rows if r]
    if not rows:
        return 0
    body = "\n\n".join(f"#{i + 1} [{r['source']}, {(r['published'] or '')[:10]}] {r['title']}\n"
                       f"{(db.unj(r['extract_json'], {}) or {}).get('summary') or (r['text'] or '')[:500]}" for i, r in enumerate(rows))
    rl = ROLES.get(role, ROLES["cfo"])
    sysm = TRIAGE_PROMPT.format(role=rl["label"], focus=rl["focus"], today=now().strftime("%Y-%m-%d"), profile=profile.brief(p, 5),
                                areas=", ".join(f"{k} ({v})" for k, v in AREAS.items()))
    data, _ = llm.chat_json([{"role": "system", "content": sysm}, {"role": "user", "content": wrap_untrusted(body)}],
                            role="agent", purpose="triage", max_tokens=4500, temperature=0.2)
    key = pkey(uid, role)
    n = 0
    for x in data.get("items") or []:
        try:
            r = rows[int(x.get("i")) - 1]
        except (TypeError, ValueError, IndexError):
            continue
        db.ex("INSERT OR REPLACE INTO triage(key,news_id,data_json,created) VALUES(?,?,?,?)", (key, r["id"], db.j(x), now().isoformat()))
        n += 1
    return n
    invalidate_feed(uid)


def triage_running(uid: str, role: str) -> bool:
    return pkey(uid, role) in _tri_running

def reasons_for(uid: str, role: str, news_id: str) -> dict | None:
    """Причины попадания конкретной новости в ленту (для контекста агента)."""
    p = profile.build(uid)
    n = db.q1("SELECT *, 1 AS n_sources FROM news WHERE id=?", (news_id,))
    if not n or not p:
        return None
    n["tags"] = db.unj(n.pop("tags_json"), {}) or {}
    n["extract"] = db.unj(n.pop("extract_json"), None)
    n["n_sources"] = max(1, db.q1("SELECT COUNT(DISTINCT source) c FROM news WHERE cluster_id=?", (n["cluster_id"] or n["id"],))["c"] or 1)
    return score(n, p, role, prefs(uid, role))
