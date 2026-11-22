import csv
import sqlite3
from contextlib import closing

import pytest

from app import config, db, kb
from scripts import build_db


def csv_file(name, cols, row):
    with (config.RAW_DIR / name).open("w", newline="") as stream:
        writer = csv.writer(stream, delimiter=";")
        writer.writerow(cols)
        writer.writerow(row)


def test_build_db_bad_input_then_success_with_backup():
    config.RAW_DIR.mkdir()
    db.ex("INSERT INTO companies(uid) VALUES('U_TEST_NEW')")
    db.kv_set("user-settings", {"saved": True})
    cols = [src for src, _ in build_db.COLS]
    csv_file("df_Uid_data_hack.csv", cols, [dict(SYNTHETIC_U="CCC", MAINOKVED_CODE="01").get(col, "") for col in cols])
    csv_file("df_Uid_payment_hack.csv", ["BENEFICIARY", "PAYER", "PAY_AMT", "PAY_CNT"], ["CCC", "CCC", 5, 1])
    csv_file("df_Fid_Uid_link_hack.csv", ["bad"], ["bad"])
    with pytest.raises(ValueError):
        build_db.main()
    assert {r["uid"] for r in db.q("SELECT uid FROM companies")} == {"AAA", "BBB", "U_TEST_NEW"}
    csv_file("df_Fid_Uid_link_hack.csv", ["SYNTHETIC_F", "CITY_NAME", "RC_NAME", "SYNTHETIC_U"], ["f", "city", "rc", "CCC"])
    build_db.main()
    assert {r["uid"] for r in db.q("SELECT uid FROM companies")} == {"CCC", "U_TEST_NEW"}
    assert db.kv_get("user-settings")["saved"]
    backups = list(config.DB_PATH.parent.glob("*.bak"))
    assert len(backups) == 1
    with closing(sqlite3.connect(backups[0])) as snapshot:
        assert snapshot.execute("SELECT count(*) FROM companies WHERE uid IN ('AAA','BBB')").fetchone()[0] == 2
        assert snapshot.execute("SELECT count(*) FROM kv WHERE k='user-settings'").fetchone()[0] == 1


def test_atomic_kb_import_rollback():
    config.KB_DIR.mkdir()
    path = config.KB_DIR / "kb.json"
    doc = {"id": "ok", "file": "ok.pdf", "title": "Рабочая БЗ", "chunks": [{"id": "chunk", "kind": "thesis", "text": "Рабочий текст"}]}
    path.write_text(db.j({"docs": [doc]}))
    assert kb.load_json() == 1
    path.write_text(db.j({"docs": [{**doc, "id": "conflict", "chunks": doc["chunks"] * 2}]}))
    with pytest.raises(sqlite3.IntegrityError):
        kb.load_json()
    assert [d["id"] for d in kb.docs()] == ["ok"]
    assert kb.chunk("chunk")["text"] == "Рабочий текст"
