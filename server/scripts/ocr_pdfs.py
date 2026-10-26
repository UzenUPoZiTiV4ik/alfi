"""pdf-сканы -> ocr_pages.json.

на macOS работают Apple Vision локально, иначе Qwen3-VL через шлюз (--engine vl).
запуск: uv run python -m scripts.ocr_pdfs [--engine vision|vl] [--only имя]
"""
from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import fitz  # PyMuPDF

from app import config

PDF_DIR = config.PDF_DIR
OUT = config.KB_DIR / "ocr_pages.json"
ENGINE_OUT = config.KB_DIR / "ocr_engine.json"
SWIFT = Path(__file__).with_name("ocr_vision.swift")


def render(pdf: Path, dpi: int, out_dir: Path) -> list[Path]:
    doc = fitz.open(pdf)
    paths = []
    for i, page in enumerate(doc):
        p = out_dir / f"{pdf.stem}__{i + 1:03d}.png"
        page.get_pixmap(dpi=dpi).save(p)
        paths.append(p)
    return paths


def ocr_vision(pngs: list[Path]) -> dict[str, str]:
    res = subprocess.run(["swift", str(SWIFT), *map(str, pngs)], capture_output=True, text=True, check=True)
    out = {}
    for line in res.stdout.splitlines():
        if line.strip().startswith("{"):
            o = json.loads(line)
            out[o["file"]] = o["text"]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=["vision", "vl"], default=None)
    ap.add_argument("--only", default=None)
    a = ap.parse_args()
    engine = a.engine or ("vision" if platform.system() == "Darwin" and shutil.which("swift") else "vl")
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    t0 = time.time()
    pdfs = sorted(PDF_DIR.glob("*.pdf"))
    for pdf in pdfs:
        if a.only and a.only not in pdf.name:
            continue
        if pdf.name in data and not a.only:
            print(f"skip {pdf.name}")
            continue
        with tempfile.TemporaryDirectory() as td:
            pngs = render(pdf, 200 if engine == "vision" else 144, Path(td))
            if engine == "vision":
                texts = ocr_vision(pngs)
            else:
                from scripts.ocr_vl import ocr_page
                texts = {p.name: ocr_page(p) for p in pngs}
            data[pdf.name] = [texts.get(p.name, "") for p in pngs]
        print(f"{pdf.name}: {len(pngs)} стр., {sum(len(t) for t in data[pdf.name])} символов", flush=True)
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    ENGINE_OUT.write_text(json.dumps({"engine": engine, "seconds": round(time.time() - t0, 1)}, ensure_ascii=False))
    print(f"готово за {time.time() - t0:.0f} с, движок {engine}", file=sys.stderr)


if __name__ == "__main__":
    main()
