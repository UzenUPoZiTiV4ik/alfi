"""Настройки сервиса: переменные окружения, роли моделей, лимиты, пути.

Все значения можно переопределить через .env или окружение контейнера.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]


def _load_env(path: Path) -> None:
    """Минимальный загрузчик .env без внешних зависимостей. Окружение важнее файла."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env(SERVER_DIR / ".env")
_load_env(SERVER_DIR.parent / ".env")


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def flag(name: str, default: bool = False) -> bool:
    return env(name, "true" if default else "false").lower() in {"1", "true", "yes", "on"}


# ---------- Пути ----------
DATA_DIR = Path(env("DATA_DIR", str(SERVER_DIR / "data")))
RAW_DIR = Path(env("RAW_DIR", str(DATA_DIR / "raw")))
KB_DIR = Path(env("KB_DIR", str(DATA_DIR / "kb")))
PDF_DIR = Path(env("PDF_DIR", str(KB_DIR / "pdf")))
DB_PATH = Path(env("DB_PATH", str(DATA_DIR / "alfi.db")))
WEB_DIR = Path(env("WEB_DIR", str(SERVER_DIR.parent / "web")))

# ---------- LLM-шлюз (только модели из списка кейса) ----------
LLM_BASE_URL = env("LLM_BASE_URL", "https://alfahack-gateway26.ru/v1").rstrip("/")
LLM_API_KEY = env("LLM_API_KEY")
# Режим мышления: "off"/"false" — выкл везде, "selective" — только на выбранных шагах, "on"/"true" — везде
LLM_REASONING_MODE = env("LLM_REASONING", "false").strip().lower()
LLM_REASONING = LLM_REASONING_MODE in {"1", "true", "yes", "on"}
LLM_REASONING_PURPOSES = {p.strip() for p in env("LLM_REASONING_PURPOSES", "synth,repair").split(",") if p.strip()}
# Уровень усилия рассуждений для reasoning-шагов: "" (по умолчанию шлюза), "low", "medium", "high"
LLM_REASONING_EFFORT = env("LLM_REASONING_EFFORT", "").strip().lower()
LLM_TIMEOUT = float(env("LLM_TIMEOUT", "90"))
# Демо-разбор по шаблону: "1" — всегда, "auto" — когда шлюз LLM недоступен, "0" — никогда
INSIGHT_DEMO = env("INSIGHT_DEMO", "auto").lower()


def reasoning_enabled(purpose: str, override: bool | None = None) -> bool:
    if override is not None:
        return bool(override)
    if LLM_REASONING:
        return True
    if LLM_REASONING_MODE == "selective":
        return purpose in LLM_REASONING_PURPOSES
    return False


def reasoning_effort_for(purpose: str, override: str | None = None) -> str:
    eff = (override if override is not None else LLM_REASONING_EFFORT).strip().lower()
    return eff if eff in {"low", "medium", "high"} else ""

ALLOWED_MODELS = {
    "deepseek/deepseek-v4.1-flash",
    "z-ai/glm-5.3-flash",
    "google/gemma-4-26b-a4b-it",
    "qwen/qwen3.6-35b-a3b",
    "qwen/qwen3-vl-30b-a3b-instruct",
    "moonshotai/kimi-k2.6",
}

# Роли моделей подобраны по замерам качество/цена (см. README и Word-документ)
MODELS = {
    "agent": env("MODEL_AGENT", "deepseek/deepseek-v4.1-flash"),     # план, синтез, чат, триаж
    "extract": env("MODEL_EXTRACT", "google/gemma-4-26b-a4b-it"),    # разметка новостей пачками
    "critic": env("MODEL_CRITIC", "z-ai/glm-5.3-flash"),             # независимая проверка
    "fallback": env("MODEL_FALLBACK", "qwen/qwen3.6-35b-a3b"),       # запасная при сбоях
    "vision": env("MODEL_VISION", "qwen/qwen3-vl-30b-a3b-instruct"), # OCR сканов на Linux
}

# ---------- Бюджет ----------
# Жёсткий лимит ключа 500 ₽/сутки (сброс 00:00 UTC). Мягкий порог сервиса ниже:
# после него новые глубокие разборы не стартуют, работают кэш и правила.
BUDGET_SOFT_RUB = float(env("BUDGET_SOFT_RUB", "120"))
BUDGET_HARD_RUB = float(env("BUDGET_HARD_RUB", "450"))

# ---------- Exa (только /search type=auto и /contents) ----------
EXA_API_KEY = env("EXA_API_KEY")
EXA_DAILY_LIMIT = int(env("EXA_DAILY_LIMIT", "300"))

# ---------- Сервис ----------
SESSION_SECRET = env("SESSION_SECRET")
SITE_PASSWORD = env("SITE_PASSWORD")
SITE_SECRET = env("SITE_SECRET") or SESSION_SECRET or secrets.token_hex(32)
SITE_BASE = env("SITE_BASE").rstrip("/")
SITE_COOKIE_TTL_H = int(env("SITE_COOKIE_TTL_H", "168"))
ADMIN_API_TOKEN = env("ADMIN_API_TOKEN")
SESSION_TTL_H = int(env("SESSION_TTL_H", "12"))
INGEST_ON_START = flag("INGEST_ON_START", False)
INGEST_INTERVAL_MIN = int(env("INGEST_INTERVAL_MIN", "60"))  # автосбор новостей, 0: выключен
INGEST_USE_EXA = flag("INGEST_USE_EXA", True)
INGEST_EXTRACT_LIMIT = int(env("INGEST_EXTRACT_LIMIT", "240"))
DEMO_MODE = env("ALFI_DEMO_MODE").strip().lower() in {"1", "true"}
CORS_ORIGINS = [o for o in env("CORS_ORIGINS", "").split(",") if o]

# Лимиты контекста синтеза: больше раздувает промпт до 12k токенов и цену
MAX_BANK_CHUNKS = 14
MAX_NEWS_CTX = 8
MAX_WEB_SEARCH_PER_RUN = 2
FEED_SIZE = 24
FEED_THRESHOLD = 0.16
