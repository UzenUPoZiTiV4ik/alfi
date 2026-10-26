"""Сохраняет схему API в docs/api/openapi.json. Запуск из корня: cd server && uv run python ../scripts/export_openapi.py"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from app.main import app  # noqa: E402

out = ROOT / "docs" / "api" / "openapi.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2), encoding="utf-8")
print(out, len(app.openapi()["paths"]), "путей")
