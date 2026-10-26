"""профиль компании: признаки feat:*, группа, контрагенты, чувствительность к факторам."""
from __future__ import annotations

from functools import lru_cache

from . import db
from .taxonomy import FACTORS, SECTORS, country_list, region_stem, sector_label

SECTOR_SENS: dict[str, dict[str, float]] = {
    "agro":         {"agro": 0.9, "trade": 0.6, "fx": 0.5, "logistics": 0.5, "tax": 0.3, "regulation": 0.4},
    "food":         {"agro": 0.6, "demand": 0.6, "inflation": 0.5, "regulation": 0.4, "logistics": 0.3},
    "beverages":    {"tax": 0.7, "regulation": 0.6, "demand": 0.6, "agro": 0.3, "inflation": 0.3},
    "retail":       {"demand": 0.85, "inflation": 0.5, "regulation": 0.4, "labor": 0.4, "realty": 0.2},
    "wholesale":    {"demand": 0.6, "fx": 0.4, "trade": 0.4, "logistics": 0.4},
    "construction": {"realty": 0.9, "rate": 0.6, "budget": 0.5, "metals": 0.35, "labor": 0.4},
    "materials":    {"realty": 0.6, "energy": 0.4, "logistics": 0.4, "demand": 0.3},
    "metals":       {"metals": 0.9, "trade": 0.6, "fx": 0.5, "energy": 0.3, "logistics": 0.3},
    "fuel":         {"oil": 0.95, "tax": 0.5, "regulation": 0.5, "logistics": 0.3, "fx": 0.3},
    "energy":       {"energy": 0.9, "regulation": 0.6, "rate": 0.3, "budget": 0.3},
    "chemicals":    {"oil": 0.5, "energy": 0.5, "trade": 0.5, "agro": 0.3},
    "pharma":       {"regulation": 0.7, "fx": 0.5, "budget": 0.5, "trade": 0.3},
    "machinery":    {"budget": 0.5, "rate": 0.4, "metals": 0.5, "trade": 0.4},
    "auto":         {"trade": 0.7, "fx": 0.6, "demand": 0.6, "regulation": 0.5, "rate": 0.3},
    "electronics":  {"trade": 0.7, "fx": 0.6, "demand": 0.5},
    "it":           {"tax": 0.5, "regulation": 0.5, "budget": 0.5, "labor": 0.6},
    "logistics":    {"logistics": 0.9, "oil": 0.5, "trade": 0.5, "labor": 0.3},
    "finance":      {"rate": 0.8, "credit": 0.8, "regulation": 0.5},
    "services":     {"demand": 0.6, "labor": 0.6, "inflation": 0.3},
}

PRODUCTS = {"rko": "Расчётный счёт", "gar": "Гарантии", "loa": "Кредиты", "lea": "Лизинг", "dep": "Депозиты",
            "zpp": "Зарплатный проект", "factoring": "Факторинг"}
CL_TYPE = {"CLIENT": "Клиент банка", "CLOSE_CLIENT": "Закрытый клиент", "PROSPECT": "Потенциальный клиент"}

def bn(x: float | None) -> str:
    x = x or 0
    if x >= 1e9:
        return f"{x / 1e9:.1f}".replace(".", ",") + " млрд ₽"
    if x >= 1e6:
        return f"{x / 1e6:.1f}".replace(".", ",") + " млн ₽"
    return f"{x / 1e3:.0f} тыс ₽"

def short_okved(name: str | None) -> str:
    n = (name or "").split(",")[0].split(";")[0]
    return n[:80]

def company_title(c: dict) -> str:
    city = (c.get("city") or "").replace("г. ", "")
    return f"{short_okved(c.get('okved_name'))}" + (f" · {city}" if city else "")

def _side(uid: str, group_id: str | None, as_payer: bool) -> dict:
    """Контрагенты одной стороны. as_payer=True: кому компания платит (поставщики)."""
    col, other = ("payer", "beneficiary") if as_payer else ("beneficiary", "payer")
    rows = db.q(f"""SELECT p.{other} AS cp, SUM(p.amt) amt, SUM(p.cnt) cnt, c.okved_name, c.sector, c.revenue, c.cl_type,
                           c.negative AS key_owner, c.group_id, c.region
                    FROM payments p LEFT JOIN companies c ON c.uid = p.{other}
                    WHERE p.{col} = ? AND p.{other} != ? GROUP BY p.{other} ORDER BY amt DESC""", (uid, uid))
    total = sum(r["amt"] or 0 for r in rows)
    intra = sum(r["amt"] or 0 for r in rows if group_id and r["group_id"] == group_id)
    ext = [r for r in rows if not (group_id and r["group_id"] == group_id)]
    ext_total = sum(r["amt"] or 0 for r in ext) or 0
    shares = [(r["amt"] or 0) / ext_total for r in ext] if ext_total else []
    sectors: dict[str, float] = {}
    for r, s in zip(ext, shares):
        if r["sector"]:
            sectors[r["sector"]] = sectors.get(r["sector"], 0) + s
    return {
        "n": len(rows), "total": total, "intra_group": intra, "external_total": ext_total,
        "top_share": round(shares[0], 3) if shares else 0.0,
        "hhi": round(sum(s * s for s in shares), 3),
        "sectors": [{"sector": k, "label": sector_label(k), "share": round(v, 3)} for k, v in sorted(sectors.items(), key=lambda x: -x[1])[:6]],
        "key_owner_share": round(sum(s for r, s in zip(ext, shares) if (r["key_owner"] or 0) > 0), 3),
        "bank_clients_share": round(sum(s for r, s in zip(ext, shares) if r["cl_type"] in ("CLIENT", "CLOSE_CLIENT")), 3),
        "top": [{
            "uid": r["cp"], "amount": r["amt"], "count": r["cnt"], "share": round(s, 3), "okved": short_okved(r["okved_name"]),
            "sector": r["sector"], "sector_label": sector_label(r["sector"]) if r["sector"] else "нет в базе",
            "revenue": r["revenue"], "client": r["cl_type"] in ("CLIENT", "CLOSE_CLIENT"), "key_owner": (r["key_owner"] or 0) > 0,
            "region": r["region"],
        } for r, s in list(zip(ext, shares))[:8]],
    }

def _group(c: dict) -> dict:
    gid = c.get("group_id")
    if not gid:
        return {"id": None, "n": 1, "revenue": c.get("revenue") or 0, "members": [], "sectors": []}
    mem = db.q("SELECT uid, okved_name, sector, revenue, region, cl_type FROM companies WHERE group_id=? ORDER BY revenue DESC", (gid,))
    tot = sum(m["revenue"] or 0 for m in mem) or 1
    secs: dict[str, float] = {}
    for m in mem:
        secs[m["sector"]] = secs.get(m["sector"], 0) + (m["revenue"] or 0) / tot
    return {
        "id": gid, "n": len(mem), "revenue": tot,
        "members": [{"uid": m["uid"], "okved": short_okved(m["okved_name"]), "sector": m["sector"], "sector_label": sector_label(m["sector"]),
                     "revenue": m["revenue"], "region": m["region"], "self": m["uid"] == c["uid"]} for m in mem[:12]],
        "sectors": [{"sector": k, "label": sector_label(k), "share": round(v, 3)} for k, v in sorted(secs.items(), key=lambda x: -x[1])[:6]],
    }

def _links(uid: str) -> dict:
    """Связи через общих физлиц (учредители, руководители и т.п. в синтетике кейса)."""
    people = db.q("SELECT DISTINCT fid FROM persons WHERE uid=?", (uid,))
    fids = [p["fid"] for p in people]
    if not fids:
        return {"persons": 0, "companies": []}
    ph = ",".join("?" * len(fids))
    rows = db.q(f"""SELECT p.uid, COUNT(DISTINCT p.fid) shared, c.okved_name, c.sector, c.revenue, c.group_id
                    FROM persons p LEFT JOIN companies c ON c.uid=p.uid
                    WHERE p.fid IN ({ph}) AND p.uid != ? GROUP BY p.uid ORDER BY shared DESC, c.revenue DESC LIMIT 10""", (*fids, uid))
    return {"persons": len(fids), "companies": [{"uid": r["uid"], "shared": r["shared"], "okved": short_okved(r["okved_name"]),
                                                 "sector": r["sector"], "revenue": r["revenue"]} for r in rows]}

def _position(c: dict) -> dict:
    rev = c.get("revenue") or 0
    out = {}
    for key, col in (("okved", "okved"), ("sector", "sector")):
        r = db.q1(f"SELECT COUNT(*) n, SUM(COALESCE(revenue,0)) s, SUM(CASE WHEN revenue > ? THEN 1 ELSE 0 END) above FROM companies WHERE {col}=?", (rev, c[col]))
        out[key] = {"rank": (r["above"] or 0) + 1, "of": r["n"], "share": round(rev / r["s"], 4) if r["s"] else 0}
    out["note"] = "Доля и ранг посчитаны только по компаниям в выборке банка, это не доля рынка"
    return out

def _combine(parts: list[tuple[float, str, str]]) -> tuple[float, list[dict]]:
    """Несколько независимых причин -> 1 - Π(1 - s), объяснения сохраняются."""
    p = 1.0
    for s, _, _ in parts:
        p *= 1 - max(0.0, min(1.0, s))
    return round(1 - p, 3), [{"text": t, "feat": f, "w": round(s, 2)} for s, t, f in parts]

def _sensitivities(c: dict, sup: dict, cus: dict, grp: dict) -> dict[str, dict]:
    raw: dict[str, list[tuple[float, str, str]]] = {k: [] for k in FACTORS}
    for f, s in SECTOR_SENS.get(c["sector"], {}).items():
        raw[f].append((s, f"отрасль «{sector_label(c['sector'])}»", "feat:sector"))
    for g in grp.get("sectors", [])[1:4]:
        if g["share"] >= 0.1:
            for f, s in SECTOR_SENS.get(g["sector"], {}).items():
                raw[f].append((s * g["share"] * 0.6, f"в группе есть бизнес «{g['label']}» ({g['share']:.0%} выручки)", "feat:group"))
    for side, name, fid in ((sup, "поставщиков", "feat:suppliers"), (cus, "покупателей", "feat:customers")):
        for g in side.get("sectors", [])[:3]:
            if g["share"] >= 0.15 and g["sector"] != c["sector"]:
                for f, s in SECTOR_SENS.get(g["sector"], {}).items():
                    raw[f].append((s * g["share"] * 0.35, f"{g['share']:.0%} {name} из отрасли «{g['label']}»", fid))
    if (c.get("loa") or 0) > 0:
        raw["rate"].append((0.45, "есть кредиты: ставка меняет процентные расходы", "feat:products"))
        raw["credit"].append((0.3, "есть кредиты: важны условия рефинансирования", "feat:products"))
    if (c.get("lea") or 0) > 0:
        raw["rate"].append((0.2, "есть лизинг", "feat:products"))
    if (c.get("dep") or 0) > 0:
        raw["rate"].append((0.15, "есть депозиты: ставка меняет доход на остатки", "feat:products"))
    if (c.get("gar") or 0) > 0:
        raw["budget"].append((0.2, "есть банковские гарантии, похоже на госзаказ или тендеры", "feat:products"))
    if (c.get("factoring") or 0) > 0:
        raw["credit"].append((0.2, "используется факторинг: важна платёжная дисциплина покупателей", "feat:products"))
    if (c.get("fts") or 0) > 0:
        cs = ", ".join(country_list(c.get("fts_country"))[:4]) or "есть"
        raw["trade"].append((0.45, f"ведёт ВЭД ({cs})", "feat:fts"))
        raw["fx"].append((0.45, f"валютная выручка или расходы по ВЭД ({cs})", "feat:fts"))
    if (c.get("negative") or 0) > 0:
        # NEGATIVEMARK значит «есть ключевой собственник», а не «плохая компания»
        raw["regulation"].append((0.1, "у компании есть ключевой собственник", "feat:owner"))
        raw["trade"].append((0.05, "у компании есть ключевой собственник", "feat:owner"))
    for side, name, fid in ((sup, "поставщике", "feat:suppliers"), (cus, "покупателе", "feat:customers")):
        if side["top_share"] >= 0.5 and side["n"] >= 1:
            raw["credit"].append((0.25, f"{side['top_share']:.0%} оборота на одном {name}", fid))
    if (c.get("revenue") or 0) >= 15e9:
        raw["tax"].append((0.25, "крупнейший налогоплательщик по масштабу: изменения налогов сразу заметны", "feat:revenue"))
    raw["inflation"].append((0.2, "издержки и цены зависят от инфляции", "feat:sector"))
    raw["rate"].append((0.15, "стоимость денег для оборотного капитала", "feat:sector"))
    if (c.get("workers_fns") or "") in ("101-250", "Более 251"):
        raw["labor"].append((0.3, f"штат {c['workers_fns']} человек", "feat:workers"))
    out = {}
    for f, parts in raw.items():
        v, why = _combine(parts)
        out[f] = {"factor": f, "label": FACTORS[f]["label"], "value": v, "why": sorted(why, key=lambda w: -w["w"])[:4]}
    return out

def _sector_weights(c: dict, grp: dict, sup: dict, cus: dict) -> dict[str, float]:
    w: dict[str, float] = {c["sector"]: 1.0}
    for g in grp.get("sectors", []):
        w[g["sector"]] = max(w.get(g["sector"], 0), round(g["share"] * 0.6, 3))
    for side in (sup, cus):
        for g in side.get("sectors", []):
            w[g["sector"]] = max(w.get(g["sector"], 0), round(g["share"] * 0.4, 3))
    w[c["sector"]] = 1.0
    return w

@lru_cache(maxsize=256)
def build(uid: str) -> dict | None:
    c = db.q1("SELECT * FROM companies WHERE uid=?", (uid,))
    if not c:
        return None
    grp = _group(c)
    sup = _side(uid, c.get("group_id"), as_payer=True)
    cus = _side(uid, c.get("group_id"), as_payer=False)
    links = _links(uid)
    pos = _position(c)
    sens = _sensitivities(c, sup, cus, grp)
    countries = country_list(c.get("fts_country"))
    products = [v for k, v in PRODUCTS.items() if (c.get(k) or 0) > 0]

    feats = [
        {"id": "feat:okved", "label": "Основной ОКВЭД", "value": f"{c['okved']} {short_okved(c['okved_name'])}"},
        {"id": "feat:sector", "label": "Отрасль", "value": sector_label(c["sector"])},
        {"id": "feat:revenue", "label": "Выручка", "value": bn(c.get("revenue"))},
        {"id": "feat:products", "label": "Продукты банка", "value": ", ".join(products) or "нет", "detail": CL_TYPE.get(c.get("cl_type"), c.get("cl_type"))},
        {"id": "feat:fts", "label": "ВЭД", "value": ", ".join(countries) if (c.get("fts") or 0) > 0 and countries else ("есть" if (c.get("fts") or 0) > 0 else "нет")},
        {"id": "feat:region", "label": "Регион", "value": f"{c.get('region') or '—'}, {c.get('city') or ''}".strip(", ")},
        {"id": "feat:workers", "label": "Сотрудники (ФНС)", "value": c.get("workers_fns") or "нет данных"},
        {"id": "feat:age", "label": "Возраст компании", "value": f"{c.get('age')} лет" if c.get("age") else "нет данных"},
        {"id": "feat:eco", "label": "Стадия", "value": c.get("eco") or "нет данных"},
        {"id": "feat:okfs", "label": "Собственность", "value": (c.get("okfs") or "").capitalize()},
        {"id": "feat:market", "label": "Позиция в отрасли (выборка банка)", "value": f"#{pos['sector']['rank']} из {pos['sector']['of']} в «{sector_label(c['sector'])}», #{pos['okved']['rank']} из {pos['okved']['of']} по ОКВЭД"},
        {"id": "feat:group", "label": "Группа", "value": f"{grp['n']} компаний, {bn(grp['revenue'])}" if grp["n"] > 1 else "одна компания"},
        {"id": "feat:suppliers", "label": "Поставщики", "value": f"{sup['n']} контрагентов, {bn(sup['total'])}, крупнейший {sup['top_share']:.0%}" if sup["n"] else "нет данных о платежах"},
        {"id": "feat:customers", "label": "Покупатели", "value": f"{cus['n']} контрагентов, {bn(cus['total'])}, крупнейший {cus['top_share']:.0%}" if cus["n"] else "нет данных о платежах"},
        {"id": "feat:owner", "label": "Ключевой собственник", "value": "есть" if (c.get("negative") or 0) > 0 else "нет"},
    ]
    return {
        "uid": uid, "title": company_title(c), "okved": c["okved"], "okved_name": c["okved_name"],
        "sector": c["sector"], "sector_label": sector_label(c["sector"]), "revenue": c.get("revenue"), "revenue_label": bn(c.get("revenue")),
        "region": c.get("region"), "city": c.get("city"), "region_stem": region_stem(c.get("region")),
        "countries": countries if (c.get("fts") or 0) > 0 else [], "products": products, "cl_type": c.get("cl_type"),
        "features": feats, "group": grp, "suppliers": sup, "customers": cus, "links": links, "position": pos,
        "sensitivities": sens, "sector_weights": _sector_weights(c, grp, sup, cus),
    }

def feature_map(p: dict) -> dict[str, dict]:
    return {f["id"]: f for f in p["features"]}

def brief(p: dict, top_factors: int = 6) -> str:
    """Компактный текст профиля для промпта модели (без внутренних коэффициентов)."""
    lines = [f"Компания {p['uid']}: {p['title']}."]
    for f in p["features"]:
        lines.append(f"[{f['id']}] {f['label']}: {f['value']}" + (f" ({f['detail']})" if f.get("detail") else ""))
    for side, name in ((p["suppliers"], "Крупные поставщики"), (p["customers"], "Крупные покупатели")):
        if side["top"]:
            items = "; ".join(f"{t['uid']} {t['sector_label']} {t['share']:.0%}"  for t in side["top"][:4])
            lines.append(f"{name}: {items}. Отрасли: " + ", ".join(f"{s['label']} {s['share']:.0%}" for s in side["sectors"][:3]))
    if p["group"]["n"] > 1:
        lines.append("Группа по отраслям: " + ", ".join(f"{s['label']} {s['share']:.0%}" for s in p["group"]["sectors"][:4]))
    top = sorted(p["sensitivities"].values(), key=lambda s: -s["value"])[:top_factors]
    lines.append("Главные каналы влияния: " + "; ".join(f"{s['label']} (" + ", ".join(w["text"] for w in s["why"][:2]) + ")" for s in top))
    return "\n".join(lines)

def featured() -> list[dict]:
    """Демо-компании: крупный бизнес от 15 млрд, по одной-две на отрасль."""
    rows = db.q("SELECT uid, okved, okved_name, sector, revenue, region, city, fts, loa, group_id FROM companies WHERE revenue >= 15e9 AND uid NOT LIKE 'U_TEST_%' ORDER BY revenue DESC")
    pick, per = [], {}
    prefer = ["U_34911", "U_1465", "U_57706", "U_9250", "U_200890", "U_3263", "U_8318", "U_4909", "U_102920", "U_88715", "U_105459", "U_26030", "U_177581"]
    by = {r["uid"]: r for r in rows}
    for u in prefer:
        if u in by:
            pick.append(by[u])
            per[by[u]["sector"]] = per.get(by[u]["sector"], 0) + 1
    for r in rows:
        if r["uid"] not in prefer and per.get(r["sector"], 0) < 1:
            pick.append(r)
            per[r["sector"]] = per.get(r["sector"], 0) + 1
    return [{"uid": r["uid"], "title": company_title(r), "sector": r["sector"], "sector_label": sector_label(r["sector"]),
             "revenue": r["revenue"], "revenue_label": bn(r["revenue"]), "region": r["region"],
             "fts": bool(r["fts"]), "credit": bool(r["loa"])} for r in pick]
