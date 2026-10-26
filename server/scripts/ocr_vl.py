"""ocr одной страницы через Qwen3-VL, нужен вне macOS."""
from __future__ import annotations

import base64
from pathlib import Path

from app import llm

PROMPT = ("Распознай весь текст на странице аналитического отчёта банка. Сохрани порядок абзацев, "
          "заголовки, числа, проценты и подписи к графикам. Таблицы передай строками через ' | '. "
          "Ничего не добавляй и не пересказывай. Если текста нет, верни пустую строку.")


def ocr_page(png: Path) -> str:
    b64 = base64.b64encode(png.read_bytes()).decode()
    msgs = [{"role": "user", "content": [
        {"type": "text", "text": PROMPT},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
    ]}]
    try:
        r = llm.chat(msgs, role="vision", purpose="ocr", max_tokens=4000, temperature=0.0, timeout=180)
    except llm.LLMError:
        return ""
    return r["content"].strip()
