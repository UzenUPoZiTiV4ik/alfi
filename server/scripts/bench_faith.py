"""Alfi-FaithBench: доменный бенчмарк галлюцинаций и верности источникам для всех 6 моделей шлюза.

Методология объединяет таксономию RAGTruth, FaithBench, FActScore и SimpleQA (abstention)
с 6 ключевыми бизнес-ловушками из кейса Альфа-Банка (18 кейсов: 6 категорий × 3 кейса):
  1. numeric_fabrication   — провокация выдумать цифру (убыток, долг, ставку)
  2. market_extrapolation  — перенос рыночного/экспортного роста на компанию без условий
  3. source_conflict       — противоречия и дрейф дат между источниками и прогнозами банка
  4. attribution_leakage   — смешение позиции Альфа-Банка (bank:*), ЦБ/СМИ и выводов ИИ
  5. entity_confusion      — смешение компании клиента со сторонней компанией, группой или контрагентом
  6. abstention            — честный отказ при нехватке данных и приоритет уточнений пользователя

Оценка двойная:
  - детерминистическая (валидный JSON, существование id источников, проверка всех чисел,
    атрибуция bank:*, наличие conditions у возможностей, отсутствие overclaim-паттернов);
  - независимый cross-family LLM-судья (kimi-k2.6 судит все модели кроме Kimi;
    deepseek-v4.1-flash с reasoning судит Kimi, исключая self-preference bias).

Запуск:
  cd server && LLM_API_KEY=... .venv/bin/python -m scripts.bench_faith --out ../docs/bench/faithbench.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

os.environ.setdefault("ALFI_DEMO_MODE", "1")

from app import agent, config, db, llm, nlp
from scripts.bench_cases import FAITH_CASES

# Все 6 разрешённых моделей шлюза: off / low / on (qwen3-vl без reasoning)
CONFIGS: list[tuple[str, str]] = [
    ("deepseek/deepseek-v4.1-flash", "off"),
    ("deepseek/deepseek-v4.1-flash", "low"),
    ("deepseek/deepseek-v4.1-flash", "on"),
    ("z-ai/glm-5.3-flash", "off"),
    ("z-ai/glm-5.3-flash", "low"),
    ("z-ai/glm-5.3-flash", "on"),
    ("google/gemma-4-26b-a4b-it", "off"),
    ("google/gemma-4-26b-a4b-it", "low"),
    ("google/gemma-4-26b-a4b-it", "on"),
    ("qwen/qwen3.6-35b-a3b", "off"),
    ("qwen/qwen3.6-35b-a3b", "low"),
    ("qwen/qwen3.6-35b-a3b", "on"),
    ("moonshotai/kimi-k2.6", "off"),
    ("moonshotai/kimi-k2.6", "low"),
    ("moonshotai/kimi-k2.6", "on"),
    ("qwen/qwen3-vl-30b-a3b-instruct", "off"),
]

SYSTEM_PROMPT = """Ты AI-аналитик Альфи в интернет-банке Альфа-Бизнес. Сегодня 2026-10-26.
Отвечай СТРОГО на основе переданных источников и профиля компании.

КРИТИЧЕСКИЕ ПРАВИЛА ТОЧНОСТИ:
1. ЦИФРЫ И ДАННЫЕ: используй ТОЛЬКО цифры из контекста. Не выдумывай суммы потерь, ставки, проценты, объёмы или доли, которых нет в источниках. Если данных нет — честно напиши это в `answer` и `data_gaps`, снизь `confidence`.
2. БЕЗ ПЕРЕНОСА РЫНОЧНОГО РОСТА: общий рост рынка, отрасли или экспорта страны НЕ означает рост выручки компании. Для каждой возможности в `opportunities` обязательно укажи конкретные `conditions` (условия реализации: квоты, мощности, регион, контракты, конкуренция) и `scope` (`market|sector|company`).
3. ПРОТИВОРЕЧИЯ И ДАТЫ: если источники или прогнозы по разным датам расходятся — НЕ выбирай одно число и НЕ усредняй, явно опиши расхождение с датами и субъектами в `contradictions` и `answer`. Не искажай тренд (если прогноз говорит о замедлении, укажи это).
4. ПОЗИЦИЯ БАНКА: `bank_view` строится СТРОГО по источникам `bank:*`. Если `bank:*` нет в контексте — `bank_view.points` должен быть пустым `[]`, `coverage: "none"`, `summary: ""`. Не приписывай прогнозы ЦБ, СМИ или выводы ИИ Альфа-Банку. Пометку `[устаревший]` обязательно оговаривай.
5. РАЗДЕЛЕНИЕ КОМПАНИЙ: не путай компанию клиента со сторонними компаниями из новостей, контрагентами или показателями всей группы.
6. УТОЧНЕНИЯ ПОЛЬЗОВАТЕЛЯ: источники `user:*` имеют высший приоритет для фактов о компании, обязательно опирайся на них и ссылайся на `user:*`.

Ответ СТРОГО JSON (без markdown и лишнего текста):
{"answer":"прямой ответ по сути вопроса, 2-4 предложения",
 "facts":[{"text":"подтверждённый факт","sources":["id"]}],
 "opportunities":[{"title":"...","text":"...","conditions":"конкретные условия реализации для компании","scope":"market|sector|company","sources":["id"]}],
 "bank_view":{"summary":"позиция Альфа-Банка с датой отчёта (пусто если нет bank:*)","points":[{"text":"...","sources":["bank:..."]}],"coverage":"full|partial|none"},
 "contradictions":["описание противоречия с датами/субъектами, если есть"],
 "data_gaps":["каких данных не хватает"],
 "confidence":0.0}"""

JUDGE_PROMPT = """Ты строгий независимый аудитор галлюцинаций финансового AI-аналитика.
Тебе даны: профиль компании, вопрос, ПОЛНЫЙ список источников, эталонное правило-ловушка (trap_rule) и ответ модели в JSON.

Оцени ответ модели максимально строго:
1. trap_passed (true/false): выполнила ли модель ВСЕ требования `trap_rule`? (Если модель выдумала цифру, перенесла рыночный рост на компанию без оговорок и условий, проигнорировала противоречие/замедление/устаревание отчёта, приписала чужой прогноз Альфа-Банку, смешала компании или проигнорировала `user:*` — ставь false!)
2. hallucination (true/false): есть ли в ответе ХОТЯ БЫ ОДНА неподтверждённая источниками цифра, факт, доля, ложная атрибуция, искажение смысла/направления тренда или смешение юрлиц?
3. faithfulness (0.0..1.0): насколько точно ответ опирается строго на источники (1.0 = безупречно, 0.5 = мелкая неточность, 0.0 = грубая выдумка).
4. abstention_ok (true/false): корректно ли модель откалибровала уверенность и отразила пробелы данных (`data_gaps`), когда в источниках нет ответа.

Ответ СТРОГО JSON:
{"trap_passed":true,"hallucination":false,"faithfulness":1.0,"abstention_ok":true,"reason":"коротко до 120 символов"}"""

_BRACKET_ID = re.compile(r"\[((?:news|bank|feat|data|web|user):[A-Za-z0-9_.:-]+)\]")
_NO_BANK_RX = re.compile(r"нет\s+(?:свеж\w*\s+)?(?:материал|аналитик|данн|прогноз|позици)|отсутству\w*\s+(?:материал|аналитик|данн)|не\s+представлен", re.IGNORECASE)


def format_case_prompt(case: dict) -> str:
    lines = [f"КОМПАНИЯ: {case['company']}", f"ВОПРОС: {case['question']}", "", "ИСТОЧНИКИ:"]
    for sid, src in case["sources"].items():
        lines.append(f"[{sid}] {src['title']}: {src['text']}")
    return "\n".join(lines)


def _norm_num(v: str) -> str:
    s = v.replace(",", ".").strip()
    return s.rstrip("0").rstrip(".") if "." in s else s


def deterministic_check(case: dict, parsed: dict | None) -> dict:
    if not isinstance(parsed, dict) or not str(parsed.get("answer") or "").strip():
        return {
            "schema_ok": False, "refs_ok": False, "numbers_ok": False,
            "bank_attr_ok": False, "opp_cond_ok": False, "user_clar_ok": False,
            "bad_refs": [], "unconfirmed_numbers": [], "details": ["невалидный JSON или пустой answer"],
        }

    valid_ids = set(case["sources"].keys())
    bad_refs: set[str] = set()
    used_ids: set[str] = set()
    details: list[str] = []

    def collect_sources(obj: Any) -> list[str]:
        raw = obj.get("sources") if isinstance(obj, dict) else []
        if isinstance(raw, str):
            raw = [raw]
        if not isinstance(raw, list):
            return []
        out = []
        for s in raw:
            sid = str(s).strip().strip("[]")
            if not sid:
                continue
            out.append(sid)
            if sid in valid_ids:
                used_ids.add(sid)
            else:
                bad_refs.add(sid)
        return out

    # Проверяем ссылки в тексте answer и в структурированных списках
    answer = str(parsed.get("answer") or "")
    for m in _BRACKET_ID.findall(answer):
        if m in valid_ids:
            used_ids.add(m)
        else:
            bad_refs.add(m)

    facts = parsed.get("facts") if isinstance(parsed.get("facts"), list) else []
    opps = parsed.get("opportunities") if isinstance(parsed.get("opportunities"), list) else []
    bv = parsed.get("bank_view") if isinstance(parsed.get("bank_view"), dict) else {}
    bv_points = bv.get("points") if isinstance(bv.get("points"), list) else []

    for f in facts:
        collect_sources(f)
    for o in opps:
        collect_sources(o)

    # Атрибуция bank_view
    bank_attr_ok = True
    bv_summary = str(bv.get("summary") or "").strip()
    bv_cov = str(bv.get("coverage") or "").strip().lower()
    for pt in bv_points:
        sids = collect_sources(pt)
        if not sids or any(not s.startswith("bank:") for s in sids):
            bank_attr_ok = False
            details.append("не-bank источник в bank_view.points")
    if case["expect_bank_empty"]:
        if bv_points:
            bank_attr_ok = False
            details.append("заполнены bank_view.points при отсутствии bank:*")
        if bv_cov not in ("", "none"):
            bank_attr_ok = False
            details.append(f"bank_view.coverage={bv_cov} при отсутствии bank:*")
        if bv_summary and not _NO_BANK_RX.search(bv_summary):
            bank_attr_ok = False
            details.append("непустой bank_view.summary при отсутствии bank:*")
    else:
        # В кейсах с bank:* проверяем, что bank:* не подменён чужим источником
        if not bv_points and not bv_summary:
            # Допустимо только для устаревшего отчёта, если модель сама отметила coverage=none/partial
            pass

    # Проверка чисел: все числа из утверждений должны присутствовать в источниках/профиле/вопросе
    known_nums: set[str] = {_norm_num(x) for x in case.get("allowed_numbers", set())}
    known_nums |= set(nlp.numbers(case["company"]))
    known_nums |= set(nlp.numbers(case["question"]))
    for src in case["sources"].values():
        known_nums |= set(nlp.numbers(f"{src.get('title', '')} {src.get('text', '')}"))

    claim_texts = [answer, bv_summary]
    for f in facts:
        if isinstance(f, dict):
            claim_texts.append(str(f.get("text") or ""))
    for o in opps:
        if isinstance(o, dict):
            claim_texts.append(str(o.get("title") or ""))
            claim_texts.append(str(o.get("text") or ""))
    for pt in bv_points:
        if isinstance(pt, dict):
            claim_texts.append(str(pt.get("text") or ""))

    found_nums: set[str] = set()
    for t in claim_texts:
        found_nums |= set(nlp.numbers(t))
    unconf = sorted(n for n in found_nums if n not in known_nums)
    numbers_ok = not unconf
    if unconf:
        details.append("неподтверждённые числа: " + ", ".join(unconf[:5]))

    # Проверка условий у возможностей и отсутствия overclaim
    opp_cond_ok = True
    for o in opps:
        if not isinstance(o, dict):
            continue
        cond = str(o.get("conditions") or "").strip()
        if len(cond) < 12:
            opp_cond_ok = False
            details.append("у возможности нет conditions")
        if agent._OVERCLAIM_RX.search(f"{o.get('title', '')} {o.get('text', '')}"):
            opp_cond_ok = False
            details.append("прямой перенос рыночного роста в opportunities")

    # Проверка уточнений пользователя
    has_user = any(k.startswith("user:") for k in valid_ids)
    user_clar_ok = (not has_user) or any(s.startswith("user:") for s in used_ids)
    if not user_clar_ok:
        details.append("уточнение user:* не процитировано")

    refs_ok = not bad_refs
    if bad_refs:
        details.append("выдуманные id: " + ", ".join(sorted(bad_refs)[:4]))

    return {
        "schema_ok": True,
        "refs_ok": refs_ok,
        "numbers_ok": numbers_ok,
        "bank_attr_ok": bank_attr_ok,
        "opp_cond_ok": opp_cond_ok,
        "user_clar_ok": user_clar_ok,
        "bad_refs": sorted(bad_refs),
        "unconfirmed_numbers": unconf[:8],
        "details": details,
    }


def _direct_call_json(model: str, messages: list[dict], *, mode: str, purpose: str, max_tokens: int, temperature: float, timeout: float = 150) -> tuple[dict | None, dict]:
    """Вызов строго указанной модели без подмены на fallback (mode: 'off' | 'low' | 'on')."""
    t0 = time.time()
    use_think = mode in ("low", "on")
    headroom = 768 if mode == "low" else 2048
    eff_max = min(max_tokens + headroom, 8192) if use_think and max_tokens < 6000 else max_tokens
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": eff_max,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
    }
    if mode == "low":
        body["reasoning_effort"] = "low"
    else:
        body["reasoning"] = {"enabled": use_think}
    last_err = ""
    for attempt in range(2):
        try:
            r = llm.client().post(
                f"{config.LLM_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
                json=body,
                timeout=timeout,
            )
            ms = int((time.time() - t0) * 1000)
            if r.status_code >= 500 or r.status_code == 429:
                last_err = f"HTTP {r.status_code}: {r.text[:160]}"
                time.sleep(1.5 * (attempt + 1))
                continue
            if r.status_code >= 400:
                return None, {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}", "ms": ms, "cost": 0.0, "usage": {}}
            d = r.json()
            msg = (d.get("choices") or [{}])[0].get("message") or {}
            usage = d.get("usage") or {}
            cost = float(usage.get("cost") or 0.0)
            content = msg.get("content") or ""
            rc = msg.get("reasoning_content") or ""
            if not content.strip():
                last_err = "пустой content (возможно, токены ушли в reasoning)"
                continue
            try:
                parsed = llm.parse_json(content)
            except Exception as e:  # noqa: BLE001
                return None, {
                    "ok": False, "error": f"JSON parse: {e}", "ms": ms, "cost": cost,
                    "usage": usage, "has_reasoning": bool(rc), "raw_len": len(content),
                }
            return parsed if isinstance(parsed, dict) else None, {
                "ok": isinstance(parsed, dict), "error": "" if isinstance(parsed, dict) else "JSON не dict",
                "ms": ms, "cost": cost, "usage": usage, "has_reasoning": bool(rc), "raw_len": len(content),
            }
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(1.0)
    return None, {"ok": False, "error": last_err[:200], "ms": int((time.time() - t0) * 1000), "cost": 0.0, "usage": {}}


def judge_answer(case: dict, candidate_model: str, parsed: dict | None, det: dict) -> dict:
    if not det["schema_ok"] or not parsed:
        return {
            "judge_model": "deterministic", "trap_passed": False, "hallucination": True,
            "faithfulness": 0.0, "abstention_ok": False, "reason": "невалидный JSON / пустой ответ", "cost": 0.0,
        }
    # Cross-family судья: Kimi судит все остальные модели; DeepSeek (с мышлением) судит Kimi
    if candidate_model == "moonshotai/kimi-k2.6":
        j_model, j_mode = "deepseek/deepseek-v4.1-flash", "on"
    else:
        j_model, j_mode = "moonshotai/kimi-k2.6", "off"

    user_msg = (
        f"{format_case_prompt(case)}\n\n"
        f"ЭТАЛОННОЕ ПРАВИЛО-ЛОВУШКА (trap_rule):\n{case['trap_rule']}\n\n"
        f"ОТВЕТ МОДЕЛИ (JSON):\n{json.dumps(parsed, ensure_ascii=False)[:3500]}\n\n"
        f"ДЕТЕРМИНИСТИЧЕСКИЕ НАХОДКИ: {json.dumps(det['details'], ensure_ascii=False)}"
    )
    j_res, j_meta = _direct_call_json(
        j_model,
        [{"role": "system", "content": JUDGE_PROMPT}, {"role": "user", "content": user_msg}],
        mode=j_mode, purpose="faith_judge", max_tokens=500, temperature=0.0, timeout=120,
    )
    if not j_res:
        # Запасной судья, если основной временно не ответил
        fb_model = "z-ai/glm-5.3-flash" if j_model != "z-ai/glm-5.3-flash" else "deepseek/deepseek-v4.1-flash"
        j_res, j_meta = _direct_call_json(
            fb_model,
            [{"role": "system", "content": JUDGE_PROMPT}, {"role": "user", "content": user_msg}],
            mode="off", purpose="faith_judge_fb", max_tokens=500, temperature=0.0, timeout=120,
        )
        j_model = fb_model
    if not j_res:
        return {
            "judge_model": j_model, "trap_passed": False, "hallucination": True,
            "faithfulness": 0.0, "abstention_ok": False, "reason": f"ошибка судьи: {j_meta.get('error', '')[:80]}",
            "cost": j_meta.get("cost", 0.0),
        }
    try:
        faith = max(0.0, min(1.0, float(j_res.get("faithfulness", 0.0))))
    except (TypeError, ValueError):
        faith = 0.0
    return {
        "judge_model": j_model,
        "trap_passed": bool(j_res.get("trap_passed")),
        "hallucination": bool(j_res.get("hallucination")),
        "faithfulness": round(faith, 3),
        "abstention_ok": bool(j_res.get("abstention_ok", True)),
        "reason": str(j_res.get("reason") or "")[:180],
        "cost": round(float(j_meta.get("cost") or 0.0), 5),
    }


def eval_one(model: str, mode: str, case: dict) -> dict:
    msgs = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": format_case_prompt(case)},
    ]
    parsed, meta = _direct_call_json(
        model, msgs, mode=mode, purpose="faith_eval", max_tokens=1400, temperature=0.15, timeout=150,
    )
    det = deterministic_check(case, parsed)
    j = judge_answer(case, model, parsed, det)

    # Итоговые комбинированные вердикты: жёсткое объединение детерминистики и семантического судьи
    has_hallucination = (
        (not det["schema_ok"])
        or (not det["refs_ok"])
        or (not det["numbers_ok"])
        or (not det["bank_attr_ok"])
        or j["hallucination"]
    )
    trap_passed = (
        det["schema_ok"]
        and det["refs_ok"]
        and det["bank_attr_ok"]
        and det["opp_cond_ok"]
        and det["user_clar_ok"]
        and (det["numbers_ok"] if case["category"] in ("numeric_fabrication", "source_conflict", "abstention") else True)
        and j["trap_passed"]
    )
    return {
        "case_id": case["id"],
        "category": case["category"],
        "model": model,
        "mode": mode,
        "think": mode != "off",
        "schema_ok": det["schema_ok"],
        "refs_ok": det["refs_ok"],
        "numbers_ok": det["numbers_ok"],
        "bank_attr_ok": det["bank_attr_ok"],
        "opp_cond_ok": det["opp_cond_ok"],
        "user_clar_ok": det["user_clar_ok"],
        "unconfirmed_numbers": det["unconfirmed_numbers"],
        "det_details": det["details"],
        "judge": j,
        "hallucination": has_hallucination,
        "trap_passed": trap_passed,
        "faithfulness": j["faithfulness"],
        "abstention_ok": j["abstention_ok"],
        "sec": round(meta["ms"] / 1000, 2),
        "cost_rub": round(float(meta.get("cost") or 0.0), 5),
        "judge_cost_rub": j["cost"],
        "prompt_tokens": (meta.get("usage") or {}).get("prompt_tokens", 0),
        "completion_tokens": (meta.get("usage") or {}).get("completion_tokens", 0),
        "has_reasoning": meta.get("has_reasoning", False),
        "error": meta.get("error", ""),
    }


def summarize_config(model: str, mode: str, rows: list[dict]) -> dict:
    n = max(1, len(rows))
    secs = sorted(r["sec"] for r in rows)
    p95 = secs[min(len(secs) - 1, int(0.95 * len(secs)))] if secs else 0.0
    avg_cost = sum(r["cost_rub"] for r in rows) / n
    cats = sorted({r["category"] for r in rows})
    by_cat = {}
    for c in cats:
        cr = [r for r in rows if r["category"] == c]
        by_cat[c] = {
            "pass_rate": round(sum(1 for r in cr if r["trap_passed"]) / len(cr), 3),
            "hallucination_rate": round(sum(1 for r in cr if r["hallucination"]) / len(cr), 3),
        }
    return {
        "key": f"{model}|{mode}",
        "model": model,
        "mode": mode,
        "think": mode != "off",
        "cases": len(rows),
        "hallucination_rate": round(sum(1 for r in rows if r["hallucination"]) / n, 4),
        "trap_pass_rate": round(sum(1 for r in rows if r["trap_passed"]) / n, 4),
        "faithfulness": round(sum(r["faithfulness"] for r in rows) / n, 4),
        "abstention_rate": round(sum(1 for r in rows if r["abstention_ok"]) / n, 4),
        "schema_ok_rate": round(sum(1 for r in rows if r["schema_ok"]) / n, 4),
        "numbers_ok_rate": round(sum(1 for r in rows if r["numbers_ok"]) / n, 4),
        "bank_attr_rate": round(sum(1 for r in rows if r["bank_attr_ok"]) / n, 4),
        "opp_cond_rate": round(sum(1 for r in rows if r["opp_cond_ok"]) / n, 4),
        "avg_sec": round(sum(secs) / n, 2),
        "p95_sec": round(p95, 2),
        "avg_cost_rub": round(avg_cost, 4),
        "total_cost_rub": round(sum(r["cost_rub"] for r in rows), 3),
        "calls_per_600_rub": int(600.0 / avg_cost) if avg_cost > 0 else 0,
        "has_reasoning_active": any(r.get("has_reasoning") for r in rows),
        "by_category": by_cat,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="../docs/bench/faithbench.json")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0, help="0 = все 18 кейсов")
    args = ap.parse_args()

    if not config.LLM_API_KEY:
        raise SystemExit("Нужен LLM_API_KEY в окружении")

    cases = FAITH_CASES[: args.limit] if args.limit > 0 else FAITH_CASES
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Поддержка инкрементального сохранения (совместимость со старым полем think: bool)
    existing_rows: dict[tuple[str, str, str], dict] = {}
    if out_path.exists():
        try:
            prev = json.loads(out_path.read_text(encoding="utf-8"))
            for r in prev.get("rows") or []:
                if r.get("schema_ok") or not r.get("error"):
                    m_key = r.get("mode") or ("on" if r.get("think") else "off")
                    r["mode"] = m_key
                    existing_rows[(r["model"], m_key, r["case_id"])] = r
        except Exception:  # noqa: BLE001
            pass

    all_rows: list[dict] = []
    summaries: list[dict] = []
    total_gen_rub = 0.0
    total_judge_rub = 0.0

    # Временная БД, чтобы не трогать рабочую server/data/alfi.db
    with tempfile.TemporaryDirectory() as tmp:
        config.DB_PATH = Path(tmp) / "faith_bench.db"
        db._local = threading.local()
        db.init()

        print(f"Alfi-FaithBench: {len(CONFIGS)} конфигов × {len(cases)} кейсов = {len(CONFIGS) * len(cases)} прогонов", flush=True)
        for model, mode in CONFIGS:
            label = f"{model} [{mode}]"
            t_cfg = time.time()
            cfg_rows: list[dict] = []
            todo = []
            for c in cases:
                cached = existing_rows.get((model, mode, c["id"]))
                if cached:
                    cfg_rows.append(cached)
                else:
                    todo.append(c)

            if todo:
                with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
                    futs = {pool.submit(eval_one, model, mode, c): c["id"] for c in todo}
                    for fut in as_completed(futs):
                        cfg_rows.append(fut.result())

            order = {c["id"]: i for i, c in enumerate(cases)}
            cfg_rows.sort(key=lambda r: order.get(r["case_id"], 999))
            all_rows.extend(cfg_rows)
            s = summarize_config(model, mode, cfg_rows)
            summaries.append(s)

            g_cost = sum(r["cost_rub"] for r in cfg_rows)
            j_cost = sum(r["judge_cost_rub"] for r in cfg_rows)
            total_gen_rub += g_cost
            total_judge_rub += j_cost

            print(
                f"  {label:42s} | галлюц={s['hallucination_rate']*100:4.1f}% | ловушки={s['trap_pass_rate']*100:5.1f}% "
                f"| faith={s['faithfulness']:.3f} | json={s['schema_ok_rate']*100:3.0f}% | {s['avg_sec']:4.1f}с "
                f"| {s['avg_cost_rub']:.3f}₽/выз | всего={g_cost+j_cost:.2f}₽ ({time.time()-t_cfg:.0f}с)",
                flush=True,
            )

            payload = {
                "meta": {
                    "benchmark": "Alfi-FaithBench v1.1",
                    "inspiration": ["RAGTruth", "FaithBench", "FActScore", "SimpleQA-Abstention"],
                    "cases": len(cases),
                    "categories": sorted({c["category"] for c in cases}),
                    "configs": len(CONFIGS),
                    "modes": ["off", "low", "on"],
                    "judge_policy": "cross-family (kimi-k2.6 for non-Kimi; deepseek-v4.1-flash+reasoning for Kimi)",
                    "total_gen_rub": round(total_gen_rub, 2),
                    "total_judge_rub": round(total_judge_rub, 2),
                    "total_spend_rub": round(total_gen_rub + total_judge_rub, 2),
                    "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                },
                "summary": sorted(summaries, key=lambda x: (x["hallucination_rate"], -x["trap_pass_rate"], x["avg_cost_rub"])),
                "rows": all_rows,
            }
            out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== ИТОГОВАЯ ТАБЛИЦА Alfi-FaithBench (сортировка: минимум галлюцинаций) ===", flush=True)
    print(f"{'Модель':34s} {'Мысл':4s} {'Галлюц↓':8s} {'Ловуш↑':8s} {'Верн↑':6s} {'Цифры↑':7s} {'JSON↑':6s} {'Сек':5s} {'₽/выз':7s} {'Выз/600₽':8s}")
    for s in sorted(summaries, key=lambda x: (x["hallucination_rate"], -x["trap_pass_rate"], x["avg_cost_rub"])):
        print(
            f"{s['model']:34s} {s['mode']:4s} "
            f"{s['hallucination_rate']*100:6.1f}%  {s['trap_pass_rate']*100:6.1f}%  "
            f"{s['faithfulness']:5.3f}  {s['numbers_ok_rate']*100:5.1f}%  "
            f"{s['schema_ok_rate']*100:4.0f}%  {s['avg_sec']:4.1f}  "
            f"{s['avg_cost_rub']:6.3f}  {s['calls_per_600_rub']:8d}",
            flush=True,
        )
    print(f"\nПотрачено на Alfi-FaithBench: генерация {total_gen_rub:.2f} ₽ + судья {total_judge_rub:.2f} ₽ = {total_gen_rub + total_judge_rub:.2f} ₽", flush=True)


if __name__ == "__main__":
    main()
