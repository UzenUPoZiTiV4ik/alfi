"""первый запуск: собрать базу и аналитику из данных кейса в server/data/.

csv -> компании и платежи, pdf -> ocr, тезисы и цитаты.
если данных нет, сервис всё равно стартует: работает режим «свой бизнес».
"""
from __future__ import annotations

import sqlite3
import sys

from app import config

CSV_FILES = ("df_Uid_data_hack.csv", "df_Uid_payment_hack.csv", "df_Fid_Uid_link_hack.csv")

def log(msg: str) -> None:
    print(f"bootstrap: {msg}", file=sys.stderr, flush=True)

def companies_loaded() -> bool:
    if not config.DB_PATH.exists():
        return False
    try:
        with sqlite3.connect(config.DB_PATH) as c:
            return c.execute("SELECT COUNT(*) FROM companies").fetchone()[0] > 0
    except sqlite3.Error:
        return False

def run(module, *argv: str) -> None:
    """Запуск main() скрипта с нужными аргументами командной строки."""
    saved = sys.argv
    sys.argv = [module.__name__, *argv]
    try:
        module.main()
    finally:
        sys.argv = saved

def main() -> None:
    if companies_loaded():
        log("база компаний уже собрана")
    elif all((config.RAW_DIR / f).exists() for f in CSV_FILES):
        from scripts import build_db
        log("собираю базу компаний и платежей из CSV")
        build_db.main()
    else:
        log(f"нет CSV кейса в {config.RAW_DIR}: работает только режим «Свой бизнес»")

    pdfs = sorted(config.PDF_DIR.glob("*.pdf"))
    if (config.KB_DIR / "kb.json").exists():
        log("база знаний уже собрана")
    elif not pdfs:
        log(f"нет PDF аналитики в {config.PDF_DIR}: позиция банка в разборах будет пустой")
    else:
        from scripts import build_kb, ocr_pdfs
        if not (config.KB_DIR / "ocr_pages.json").exists():
            log(f"OCR {len(pdfs)} PDF (macOS: Apple Vision, иначе Qwen3-VL через шлюз)")
            run(ocr_pdfs)
        log("извлекаю тезисы, прогнозы и цитаты")
        run(build_kb)

if __name__ == "__main__":
    main()
