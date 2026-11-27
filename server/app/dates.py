"""Проверка и нормализация дат: публикации новостей, сроки вступления законов, безопасный разбор ISO."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any

MIN_PUB_YEAR = 2015
MIN_EFF_YEAR = 2020
MAX_EFF_YEAR = 2035

_ISO_DATE_RX = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$")
_RU_DATE_RX = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})(?:\s.*)?$")
_YEAR_MONTH_RX = re.compile(r"^(\d{4})-(\d{2})$")
_YEAR_ONLY_RX = re.compile(r"^(\d{4})$")

_MONTHS_LOC = (
    "январе", "феврале", "марте", "апреле", "мае", "июне",
    "июле", "августе", "сентябре", "октябре", "ноябре", "декабре",
)


def parse_utc_safe(raw: str | None, default: datetime | None = None) -> datetime:
    """Безопасный разбор ISO/RFC даты в timezone-aware UTC datetime (никогда не бросает исключение)."""
    fallback = default or datetime.now(timezone.utc)
    if fallback.tzinfo is None:
        fallback = fallback.replace(tzinfo=timezone.utc)
    if not raw or not isinstance(raw, str):
        return fallback.astimezone(timezone.utc)
    s = raw.strip()
    if not s:
        return fallback.astimezone(timezone.utc)
    dt: datetime | None = None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = parsedate_to_datetime(s)
        except (TypeError, ValueError):
            m = _RU_DATE_RX.match(s)
            if m:
                try:
                    dt = datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), tzinfo=timezone.utc)
                except ValueError:
                    dt = None
    if dt is None:
        return fallback.astimezone(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_published(raw: str | None, *, now_dt: datetime | None = None, max_future_skew_min: int = 15) -> str | None:
    """Нормализует дату публикации в ISO-8601 UTC. Отсекает мусорные годы и даты из далёкого будущего."""
    if not raw or not isinstance(raw, str) or not raw.strip():
        return None
    s = raw.strip()
    dt: datetime | None = None
    try:
        dt = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            m = _RU_DATE_RX.match(s)
            if m:
                try:
                    dt = datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), tzinfo=timezone.utc)
                except ValueError:
                    dt = None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    ref = now_dt or datetime.now(timezone.utc)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=timezone.utc)
    if dt.year < MIN_PUB_YEAR:
        return None
    if dt > ref + timedelta(minutes=max_future_skew_min):
        return ref.astimezone(timezone.utc).isoformat()
    return dt.isoformat()


def normalize_effective_date(value: Any) -> str | None:
    """Строгая нормализация effective_date в YYYY-MM-DD. Неполные даты ('2026', '2026-10') возвращает как None."""
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    d: date | None = None
    m_iso = _ISO_DATE_RX.match(s)
    if m_iso:
        try:
            d = date(int(m_iso.group(1)), int(m_iso.group(2)), int(m_iso.group(3)))
        except ValueError:
            d = None
    else:
        m_ru = _RU_DATE_RX.match(s)
        if m_ru:
            try:
                d = date(int(m_ru.group(3)), int(m_ru.group(2)), int(m_ru.group(1)))
            except ValueError:
                d = None
    if d is None or not (MIN_EFF_YEAR <= d.year <= MAX_EFF_YEAR):
        return None
    return d.isoformat()


def coarse_deadline_label(value: Any) -> str:
    """Если модель вернула неполную дату ('2026-10' или '2026'), превращает её в аккуратную текстовую подпись срока."""
    if not isinstance(value, str):
        return ""
    s = value.strip()
    m_ym = _YEAR_MONTH_RX.match(s)
    if m_ym:
        y, mo = int(m_ym.group(1)), int(m_ym.group(2))
        if MIN_EFF_YEAR <= y <= MAX_EFF_YEAR and 1 <= mo <= 12:
            return f"в {_MONTHS_LOC[mo - 1]} {y}"
    m_y = _YEAR_ONLY_RX.match(s)
    if m_y:
        y = int(m_y.group(1))
        if MIN_EFF_YEAR <= y <= MAX_EFF_YEAR:
            return f"в {y} году"
    return ""
