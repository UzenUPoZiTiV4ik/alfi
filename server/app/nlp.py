"""тексты: токены, стемминг, BM25, жаккар, нечёткая проверка цитат.

эмбеддингов в списке моделей нет, поэтому поиск лексический.
"""
from __future__ import annotations

import difflib
import math
import re
from collections import Counter
from functools import lru_cache

import snowballstemmer

_ru = snowballstemmer.stemmer("russian")
_en = snowballstemmer.stemmer("english")
_TOKEN = re.compile(r"[a-zа-яё0-9]+(?:[.,][0-9]+)?", re.IGNORECASE)

STOP = set("""
и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему
теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они
тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого
какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой
хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше
чуть том нельзя такой им более всегда конечно всю между это также году года г млн млрд тыс руб рублей процентов
the a an of to in on for and or is are was were by with as at from that this be it its which
""".split())

@lru_cache(maxsize=200_000)
def stem(w: str) -> str:
    w = w.lower().replace("ё", "е")
    if re.match(r"^[a-z]+$", w):
        return _en.stemWord(w)
    if re.match(r"^[а-я]+$", w):
        return _ru.stemWord(w)
    return w

def tokens(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text or "")]

def stems(text: str, keep_stop: bool = False) -> list[str]:
    out = []
    for t in tokens(text):
        if not keep_stop and (t in STOP or len(t) < 2):
            continue
        out.append(stem(t))
    return out

def jaccard(a: str, b: str) -> float:
    sa, sb = set(stems(a)), set(stems(b))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)

def fuzzy_contains(haystack: str, needle: str, threshold: float = 0.8) -> tuple[bool, float]:
    """Есть ли цитата в тексте страницы: доля стемов цитаты, найденных в окне страницы.

    OCR даёт переносы и опечатки, поэтому точное вхождение не годится.
    Сравниваем скользящим окном по стемам, чтобы совпадение было локальным, а не размазанным по странице.
    """
    ns = stems(needle)
    if not ns:
        return False, 0.0
    hs = stems(haystack)
    if not hs:
        return False, 0.0
    # OCR путает буквы, поэтому похожий стем на странице считаем совпадением
    page_set = set(hs)
    ns = [s if s in page_set or len(s) < 4 else (difflib.get_close_matches(s, page_set, n=1, cutoff=0.8) or [s])[0] for s in ns]
    need = Counter(ns)
    w = max(len(ns) + 6, int(len(ns) * 1.5))
    best = 0.0
    step = max(1, len(ns) // 4)
    for i in range(0, max(1, len(hs) - len(ns) // 2), step):
        win = Counter(hs[i:i + w])
        hit = sum(min(c, win[s]) for s, c in need.items())
        best = max(best, hit / len(ns))
        if best >= 0.999:
            break
    return best >= threshold, round(best, 3)

_ELLIPSIS = re.compile(r"\s*(?:\.\.\.|…)\s*")

def verify_quote(page_text: str, quote: str, threshold: float = 0.8) -> tuple[bool, float]:
    """Проверка цитаты, склеенной моделью из нескольких кусков через «...».

    Каждый кусок ищется отдельно. Короткие куски (меньше 3 стемов) засчитываются,
    если все их числа есть на странице: так проверяются строки таблиц, которые OCR разносит по столбцам.
    """
    parts = [p for p in _ELLIPSIS.split(quote or "") if p.strip()]
    if not parts:
        return False, 0.0
    page_nums = set(numbers(page_text))
    scores = []
    for p in parts:
        st = stems(p)
        nums = numbers(p)
        if len(st) < 3 or (nums and len(nums) * 2 >= len(st)):
            scores.append(1.0 if nums and all(n in page_nums for n in nums) else (0.0 if nums else 1.0))
            continue
        scores.append(fuzzy_contains(page_text, p, threshold)[1])
    s = min(scores)
    return s >= threshold, round(s, 3)

NUM_RX = re.compile(r"(?<![\w.])(\d+(?:[.,]\d+)?)\s*(%|п\.?\s*п\.?|б\.?\s*п\.?|млрд|млн|трлн|тыс|₽|руб|\$|долл)?", re.IGNORECASE)

def numbers(text: str) -> list[str]:
    """Значимые числа для проверки «цифры есть в источниках». Годы и мелкие порядковые числа пропускаем."""
    out = []
    for m in NUM_RX.finditer(text or ""):
        raw, unit = m.group(1), (m.group(2) or "")
        v = raw.replace(",", ".")
        try:
            f = float(v)
        except ValueError:
            continue
        if not unit and (1990 <= f <= 2035 or f < 10):
            continue
        out.append(v.rstrip("0").rstrip(".") if "." in v else v)
    return out

class BM25:
    """Классический Okapi BM25 по стемам."""

    def __init__(self, docs: list[list[str]], k1: float = 1.4, b: float = 0.72):
        self.k1, self.b = k1, b
        self.docs = docs
        self.n = len(docs)
        self.lens = [len(d) for d in docs]
        self.avg = (sum(self.lens) / self.n) if self.n else 1.0
        self.tf = [Counter(d) for d in docs]
        df: Counter = Counter()
        for d in self.tf:
            df.update(d.keys())
        self.idf = {t: math.log(1 + (self.n - c + 0.5) / (c + 0.5)) for t, c in df.items()}

    def scores(self, query: list[str]) -> list[float]:
        q = [t for t in query if t in self.idf]
        out = [0.0] * self.n
        if not q:
            return out
        for i, tf in enumerate(self.tf):
            s = 0.0
            dl = self.lens[i] or 1
            for t in q:
                f = tf.get(t)
                if f:
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * dl / self.avg))
            out[i] = s
        return out

    def top(self, query: list[str], k: int = 10) -> list[tuple[int, float]]:
        sc = self.scores(query)
        idx = sorted(range(self.n), key=lambda i: -sc[i])[:k]
        return [(i, sc[i]) for i in idx if sc[i] > 0]
