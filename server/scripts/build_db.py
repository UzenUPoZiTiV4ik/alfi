"""csv кейса -> sqlite: companies, payments, persons, group_stats.

запуск: uv run python -m scripts.build_db
"""
from __future__ import annotations

import csv
import sys
import time

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


def num(v: str) -> float | None:
    try:
        return float(v) if v not in ("", None) else None
    except ValueError:
        return None


def main() -> None:
    t0 = time.time()
    if config.DB_PATH.exists():
        config.DB_PATH.unlink()
        for ext in ("-wal", "-shm"):
            p = config.DB_PATH.with_name(config.DB_PATH.name + ext)
            if p.exists():
                p.unlink()
    db.init()
    c = db.conn()

    seen: set[str] = set()  # в CSV есть дубли SYNTHETIC_U
    rows = []
    with open(config.RAW_DIR / "df_Uid_data_hack.csv", encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter=";"):
            uid = r["SYNTHETIC_U"]
            if uid in seen:
                continue
            seen.add(uid)
            vals = [num(r[src]) if dst in NUM else (r[src] or None) for src, dst in COLS]
            vals.append(sector_of(r["MAINOKVED_CODE"]))
            rows.append(vals)
    names = [d for _, d in COLS] + ["sector"]
    c.executemany(f"INSERT INTO companies({','.join(names)}) VALUES({','.join('?' * len(names))})", rows)
    print(f"companies: {len(rows)}")

    with open(config.RAW_DIR / "df_Uid_payment_hack.csv", encoding="utf-8") as f:
        rd = csv.DictReader(f, delimiter=";")
        batch, n = [], 0
        for r in rd:
            batch.append((r["BENEFICIARY"], r["PAYER"], num(r["PAY_AMT"]) or 0.0, int(float(r["PAY_CNT"] or 0))))
            if len(batch) >= 100_000:
                c.executemany("INSERT INTO payments VALUES(?,?,?,?)", batch)
                n += len(batch)
                batch = []
        c.executemany("INSERT INTO payments VALUES(?,?,?,?)", batch)
        print(f"payments: {n + len(batch)}")

    with open(config.RAW_DIR / "df_Fid_Uid_link_hack.csv", encoding="utf-8") as f:
        prs = [(r["SYNTHETIC_F"], r["CITY_NAME"], r["RC_NAME"], r["SYNTHETIC_U"]) for r in csv.DictReader(f, delimiter=";")]
    c.executemany("INSERT INTO persons VALUES(?,?,?,?)", prs)
    print(f"persons links: {len(prs)}")

    c.execute("""INSERT INTO group_stats SELECT group_id, COUNT(*), SUM(COALESCE(revenue,0))
                 FROM companies WHERE group_id IS NOT NULL GROUP BY group_id""")
    c.commit()
    big = db.q1("SELECT COUNT(*) n FROM companies WHERE revenue >= 15e9")["n"]
    bigg = db.q1("SELECT COUNT(*) n FROM group_stats WHERE revenue >= 15e9")["n"]
    print(f"компаний от 15 млрд: {big}, групп от 15 млрд: {bigg}, {time.time() - t0:.1f} с", file=sys.stderr)


if __name__ == "__main__":
    main()
