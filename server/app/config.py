"""настройки из окружения и .env: модели, лимиты, пути."""
from __future__ import annotations

import os
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = SERVER_DIR.parent

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

# корневой .env (его же читает compose) и server/.env для локальных правок
_load_env(SERVER_DIR / ".env")
_load_env(ROOT_DIR / ".env")

def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)

def flag(name: str, default: bool = False) -> bool:
    return env(name, "true" if default else "false").lower() in {"1", "true", "yes", "on"}

# ---------- Пути ----------
# данные кейса и база; в докере это том
DATA_DIR = Path(env("DATA_DIR", str(SERVER_DIR / "data")))
RAW_DIR = Path(env("RAW_DIR", str(DATA_DIR / "raw")))
PDF_DIR = Path(env("PDF_DIR", str(DATA_DIR / "kb" / "pdf")))
DB_PATH = Path(env("DB_PATH", str(DATA_DIR / "alfi.db")))
# готовый текст аналитики, чтобы не гонять OCR каждый раз
KB_DIR = Path(env("KB_DIR", str(SERVER_DIR / "data" / "kb")))
WEB_DIR = Path(env("WEB_DIR", str(ROOT_DIR / "web")))

# ---------- LLM-шлюз (только модели из списка кейса) ----------
LLM_BASE_URL = env("LLM_BASE_URL", "https://api.alfahack-gateway26.ru/v1").rstrip("/")
LLM_API_KEY = env("LLM_API_KEY")
LLM_TIMEOUT = float(env("LLM_TIMEOUT", "90"))
# размышления reasoning-моделей: в проде выключены, включаются только для замеров
LLM_REASONING = flag("LLM_REASONING", False)

ALLOWED_MODELS = {
    "deepseek/deepseek-v4.1-flash",
    "z-ai/glm-5.3-flash",
    "google/gemma-4-26b-a4b-it",
    "qwen/qwen3.6-35b-a3b",
    "qwen/qwen3-vl-30b-a3b-instruct",
    "moonshotai/kimi-k2.6",
}

# модели подобраны по цене и качеству, подробности в README
MODELS = {
    "agent": env("MODEL_AGENT", "deepseek/deepseek-v4.1-flash"),     # план, синтез, чат, триаж
    "extract": env("MODEL_EXTRACT", "google/gemma-4-26b-a4b-it"),    # разметка новостей пачками
    "critic": env("MODEL_CRITIC", "z-ai/glm-5.3-flash"),             # независимая проверка
    "fallback": env("MODEL_FALLBACK", "qwen/qwen3.6-35b-a3b"),       # запасная при сбоях
    "vision": env("MODEL_VISION", "qwen/qwen3-vl-30b-a3b-instruct"), # OCR сканов на Linux
}

# ---------- Бюджет ----------
# лимит ключа 500 ₽/сутки; после мягкого порога разборы не стартуют, лента и чат живут
BUDGET_SOFT_RUB = float(env("BUDGET_SOFT_RUB", "120"))
BUDGET_HARD_RUB = float(env("BUDGET_HARD_RUB", "450"))

# ---------- Exa (только /search type=auto и /contents) ----------
EXA_API_KEY = env("EXA_API_KEY")
EXA_DAILY_LIMIT = int(env("EXA_DAILY_LIMIT", "300"))

# ---------- Сервис ----------
SESSION_SECRET = env("SESSION_SECRET", "dev-secret-change-me")

# необязательный пароль на весь сайт, кука живёт неделю
SITE_PASSWORD = env("SITE_PASSWORD", "")
SITE_SECRET = env("SITE_SECRET", SESSION_SECRET)
SITE_BASE = env("SITE_BASE", "").rstrip("/")      # /alfi, если приложение живёт под префиксом
SITE_COOKIE_TTL_H = int(env("SITE_COOKIE_TTL_H", "168"))
SESSION_TTL_H = int(env("SESSION_TTL_H", "12"))
INGEST_ON_START = flag("INGEST_ON_START", False)
INGEST_INTERVAL_MIN = int(env("INGEST_INTERVAL_MIN", "60"))  # автосбор новостей, 0: выключен
INGEST_USE_EXA = flag("INGEST_USE_EXA", True)
INGEST_EXTRACT_LIMIT = int(env("INGEST_EXTRACT_LIMIT", "240"))
DEMO_MODE = flag("DEMO_MODE", True)
CORS_ORIGINS = [o for o in env("CORS_ORIGINS", "").split(",") if o]

# больше контекста = дороже промпт
MAX_BANK_CHUNKS = 14
MAX_NEWS_CTX = 8
MAX_WEB_SEARCH_PER_RUN = 2
FEED_SIZE = 24
FEED_THRESHOLD = 0.16
