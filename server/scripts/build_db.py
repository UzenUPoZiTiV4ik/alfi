"""CSV кейса -> SQLite (companies, payments, persons, group_stats).

Запуск: uv run python -m scripts.build_db
Входные файлы в data/raw/ (скачиваются scripts/fetch_data.py).
"""
from __future__ import annotations

import csv
import math
import os
import sqlite3
import sys
import tempfile
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from app import config, db
from app.taxonomy import sector_of

COLS = [
    ("SYNTHETIC_U", "uid"), ("ORG_TYPE", "org_type"), ("OKFS_NAME", "okfs"), ("COMPANY_AGE_YEARS_GRADATION", "age"),
    ("ECO_MARK_LABEL", "eco"), ("MAINOKVED_CODE", "okved"), ("MAINOKVED_NAME", "okved_name"), ("NEGATIVEMARK", "negative"),
    ("AMOUNT_WORKERS_FNS_GRADATION", "workers_fns"), ("AMOUNT_WORKERS_SPARK_GRADATION", "workers_spark"), ("CL_TYPE", "cl_type"),
    ("CL_PRODUCT_RKO_MARK", "rko"), ("CL_PRODUCT_GAR_MARK", "gar"), ("CL_PRODUCT_LOA_MARK", "loa"), ("CL_PRODUCT_LEA_MARK", "lea"),
    ("CL_PRODUCT_DEP_MARK", "dep"), ("CL_PRODUCT_ZPP_MARK", "zpp"), ("FTS_FLAG", "fts"), ("FTS_COUNTRY_NAME", "fts_country"),
    ("FACTORING_MARK", "factoring"), ("REVENUE_COMPANY", "revenue"), ("GROUP_ID", "group_id"), ("CITY", "city"), ("REGION", "region"),
]
NUM = {"negative", "rko", "gar", "loa", "lea", "dep", "zpp", "fts", "factoring", "revenue"}


COMPANY_COLS = [dst for _, dst in COLS] + ["sector"]


def csv_rows(filename: str, required: list[str], keys: list[str]):
    path = config.RAW_DIR / filename
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=";", strict=True)
        header = reader.fieldnames or []
        if not set(required) <= set(header) or len(set(header)) != len(header):
            raise ValueError(f"{path}: неверные заголовки CSV")
        count = 0
        for row in reader:
            if None in row or None in row.values() or any(not row[k].strip() for k in keys):
                raise ValueError(f"{path}:{reader.line_num}: неверная структура строки или пустой ID")
            count += 1
            yield row
        if not count:
            raise ValueError(f"{path}: нет строк данных")


def num(value: str) -> float | None:
    if not value.strip():
        return None
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"Некорректное число {value!r}")
    return number


def company_rows():
    for row in csv_rows("df_Uid_data_hack.csv", [src for src, _ in COLS], ["SYNTHETIC_U"]):
        if row["SYNTHETIC_U"].startswith("U_TEST_"):
            raise ValueError("U_TEST_ зарезервирован для компаний, созданных пользователями")
        values = [num(row[src]) if dst in NUM else (row[src] or None) for src, dst in COLS]
        yield [*values, sector_of(row["MAINOKVED_CODE"])]


def payment_rows():
    cols = ["BENEFICIARY", "PAYER", "PAY_AMT", "PAY_CNT"]
    for row in csv_rows("df_Uid_payment_hack.csv", cols, cols[:2]):
        count = num(row["PAY_CNT"]) or 0.0
        if not count.is_integer():
            raise ValueError(f"PAY_CNT должен быть целым: {count}")
        yield row["BENEFICIARY"], row["PAYER"], num(row["PAY_AMT"]) or 0.0, int(count)


def stage_inputs(stage: sqlite3.Connection) -> None:
    # Временная SQLite на диске ограничивает расход памяти и фиксирует проверенную версию CSV.
    columns = ",".join(COMPANY_COLS)
    placeholders = ",".join("?" for _ in COMPANY_COLS)
    stage.execute(f"CREATE TABLE companies({columns}, PRIMARY KEY(uid))")
    stage.execute("CREATE TABLE payments(beneficiary,payer,amt,cnt)")
    stage.execute("CREATE TABLE persons(fid,city,rc,uid)")
    stage.executemany(f"INSERT INTO companies VALUES({placeholders}) ON CONFLICT(uid) DO NOTHING", company_rows())
    stage.executemany("INSERT INTO payments VALUES(?,?,?,?)", payment_rows())
    cols = ["SYNTHETIC_F", "CITY_NAME", "RC_NAME", "SYNTHETIC_U"]
    rows = csv_rows("df_Fid_Uid_link_hack.csv", cols, ["SYNTHETIC_F", "SYNTHETIC_U"])
    stage.executemany("INSERT INTO persons VALUES(?,?,?,?)", (tuple(row[k] for k in cols) for row in rows))
    stage.commit()


def backup(path: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    fd, filename = tempfile.mkstemp(prefix=f"{path.name}.{stamp}.", suffix=".bak", dir=path.parent)
    os.close(fd)
    dest = Path(filename)
    try:
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as src:
            with closing(sqlite3.connect(dest)) as target:
                src.backup(target)  # Включает подтверждённые записи из WAL.
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    return dest


def main() -> None:
    started = time.monotonic()
    with closing(sqlite3.connect("")) as stage:
        stage_inputs(stage)
        if config.DB_PATH.exists():
            print(f"Резервная копия: {backup(config.DB_PATH)}", file=sys.stderr)
        db.init()
        with db.transaction() as connection:
            connection.execute("DELETE FROM companies WHERE uid NOT GLOB 'U_TEST_*'")
            connection.execute("DELETE FROM payments")
            connection.execute("DELETE FROM persons")
            connection.execute("DELETE FROM group_stats")
            tables = {"companies": COMPANY_COLS, "payments": ["beneficiary", "payer", "amt", "cnt"],
                      "persons": ["fid", "city", "rc", "uid"]}
            for table, columns in tables.items():
                names = ",".join(columns)
                placeholders = ",".join("?" for _ in columns)
                rows = stage.execute(f"SELECT {names} FROM {table}")
                connection.executemany(f"INSERT INTO {table}({names}) VALUES({placeholders})", rows)
            connection.execute("""INSERT INTO group_stats SELECT group_id, COUNT(*), SUM(COALESCE(revenue,0))
                                  FROM companies WHERE group_id IS NOT NULL GROUP BY group_id""")
    print(f"Справочники обновлены за {time.monotonic() - started:.1f} с", file=sys.stderr)


if __name__ == "__main__":
    main()
