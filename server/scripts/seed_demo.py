"""Синтетическая база без CSV и сетевых запросов. Из корня репозитория:

server/.venv/bin/python server/scripts/seed_demo.py --db /tmp/alfi-demo.db
cd server && ALFI_DEMO_MODE=1 DB_PATH=/tmp/alfi-demo.db uv run uvicorn app.main:app
"""

import argparse
import os
import sqlite3
import sys
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]


def frozen_now() -> datetime | None:
    value = os.environ.get("ALFI_FROZEN_NOW", "").strip()
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError("ALFI_FROZEN_NOW: ожидается дата ISO 8601, например 2026-10-26T20:30:00Z") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def populate(conn: sqlite3.Connection) -> None:
    sys.path.insert(0, str(SERVER))
    from app.db import SCHEMA, j

    now = frozen_now() or datetime.now(UTC)
    conn.executescript(SCHEMA)
    conn.executemany("""
        INSERT INTO companies (uid, okved, okved_name, sector, city, region, revenue, cl_type, org_type, rko, loa)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'CLIENT', 'ООО', 1, 1)
    """, [
        ("U_DEMO_AGRO", "01.11", "Выращивание зерновых", "agro", "Воронеж", "Воронежская область", 18e9),
        ("U_DEMO_FOOD", "10.71", "Производство хлеба", "food", "Казань", "Татарстан", 16e9),
    ])
    conn.execute("INSERT INTO payments (beneficiary, payer, amt, cnt) VALUES (?, ?, ?, ?)",
                 ("U_DEMO_AGRO", "U_DEMO_FOOD", 1_200_000, 4))

    stories = [
        ("grain", "Расширены посевы зерновых", "Учебное хозяйство увеличило посевную площадь.", "agro", "agro"),
        ("bread", "Растёт спрос на хлеб", "Учебная пекарня получила заказы от новых магазинов.", "food", "demand"),
        ("rail", "Открыт маршрут для перевозки зерна", "Учебный кооператив сократил срок доставки.", "agro", "logistics"),
    ]
    for hours, (slug, title, body, sector, factor) in enumerate(stories, start=1):
        story_id = f"demo-{slug}"
        published = (now - timedelta(hours=hours)).isoformat()
        tags = {"business": True, "sectors": {sector: 3}, "factors": {factor: 3}}
        conn.execute("""
            INSERT INTO news (id, cluster_id, title, text, source, source_id, origin, url, published, fetched, tags_json)
            VALUES (?, ?, ?, ?, 'Учебный вестник', 'demo', 'rss', ?, ?, ?, ?)
        """, (story_id, story_id, title, body, f"https://example.org/{slug}", published, published, j(tags)))

    thesis = "В учебном сценарии рост урожая увеличивает предложение зерна для переработчиков."
    conn.execute("""
        INSERT INTO kb_docs (id, file, title, date, kind, pages, summary, meta_json)
        VALUES ('demo-grain', 'demo-grain.pdf', 'Демо: рынок зерна', ?, 'обзор', 1, ?, '{}')
    """, (now.date().isoformat(), thesis))
    conn.execute("""
        INSERT INTO kb_chunks (id, doc_id, kind, page, text, quote, quote_verified, factors_json, sectors_json, meta_json)
        VALUES ('bank:demo-grain:t1', 'demo-grain', 'thesis', 1, ?, ?, 1, ?, ?, '{}')
    """, (thesis, thesis, j(["agro"]), j(["agro", "food"])))
    conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", type=Path, default=SERVER / "data" / "demo.db", help="Выходной файл (server/data/demo.db)")
    parser.add_argument("--force", action="store_true", help="Заменить содержимое существующей SQLite-базы")
    args = parser.parse_args()
    path = args.db.expanduser().absolute()
    try:
        with closing(sqlite3.connect(":memory:")) as source:
            populate(source)
            path.parent.mkdir(parents=True, exist_ok=True)
            if not args.force:
                path.touch(exist_ok=False)
            # SQLite backup записывает весь снимок одной транзакцией, включая базы в режиме WAL.
            with closing(sqlite3.connect(path)) as target:
                source.backup(target)
    except FileExistsError:
        parser.exit(1, f"Файл уже существует: {path}. Выберите другой --db или укажите --force.\n")
    except (OSError, sqlite3.Error, ValueError) as error:
        parser.exit(1, f"Ошибка создания базы: {error}\n")
    print(f"Демо-база готова: {path}")


if __name__ == "__main__":
    main()
