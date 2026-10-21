"""
Emotion Engine — محرّك مشاعر اللهجة المصرية (الخطوة 8)
──────────────────────────────────────────────────────
يتخطّى «إيجابي/سلبي» لتمييز ١١ شعوراً في كلام العميل المصري ويبني *خطاً زمنياً*
لتغيّر المشاعر عبر المكالمة:
  غضب · إحباط · حيرة · خوف · توتر · رضا · حماس · تردد · تهكّم · استعجال · ثقة

الاكتشاف حتمي وسريع (بلا LLM): عبارات دالّة لكل شعور (معجم قابل للتحرير)، مع:
  • حارس نفي — العبارة المسبوقة بـ«مش/ما» تُتجاهَل («مش قلقان» ≠ خوف).
  • تهكّم سياقي — يُحسب فقط لو ظهر مديح ساخر *مع* غضب/إحباط في نفس الدور.
  • خط زمني — يحلّل أدوار العميل ويطلّع البداية/الأبرز/النهاية + اتجاه (تصاعد/تحسّن).

الناتج يُحقن كتلميح في برومبت التحليل اللحظي (قراءة الدور) والتقرير (الخط الزمني)،
فيُحسّن customer_sentiment واللحظات الحرجة *بدون* تغيير أي حقل أو مخطّط.

المعجم قابل للتحرير: pipeline/emotion/emotion_lexicon.json (أو SCM_EMOTION_LEXICON_PATH).
آمن ضد الملفات الناقصة/التالفة، ولا يرمي استثناءً للمتصل أبداً.
"""
from __future__ import annotations

import json
import logging
import os
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger("pipeline.emotion")

_DEFAULT_LEXICON_PATH = Path(__file__).with_name("emotion_lexicon.json")

# ترتيب الأولوية عند تعادل النتيجة (الأهم للتوجيه أولاً).
_PRIORITY = ["غضب", "تهكّم", "إحباط", "خوف", "توتر", "استعجال", "حيرة",
             "تردد", "رضا", "حماس", "ثقة"]
_PRIORITY_INDEX = {e: i for i, e in enumerate(_PRIORITY)}

# المشاعر السلبية (لوزن الذروة والاتجاه) والمُنبِّهة (لتلميح اللحظي).
_NEGATIVE = frozenset({"غضب", "تهكّم", "إحباط", "خوف", "توتر", "استعجال", "حيرة"})
_ALERTING = _NEGATIVE
_POSITIVE = frozenset({"رضا", "حماس", "ثقة"})

_SARCASM = "تهكّم"

# أدوات نفي مصرية — لو سبقت العبارة مباشرةً نتجاهلها.
_NEG_TOKENS = frozenset({"مش", "مِش", "مو", "ما", "مهو", "مب"})
_NONWORD_RE = re.compile(r"[^\w]", re.UNICODE)
_LINE_RE = re.compile(r"^\[(?P<role>[^\]]+)\]\s*:\s*(?P<text>.*)$")


def _intensity(score: int) -> str:
    return "مرتفع" if score >= 3 else "متوسط" if score == 2 else "منخفض"


@dataclass(frozen=True)
class EmotionReading:
    """قراءة مشاعر دور واحد: النتيجة الخام لكل شعور (عدد العبارات المميّزة)."""
    scores: dict[str, int] = field(default_factory=dict)

    def is_neutral(self) -> bool:
        return not self.scores

    @property
    def dominant(self) -> "str | None":
        if not self.scores:
            return None
        # الأعلى نتيجةً؛ وعند التعادل الأعلى أولويةً (index أصغر).
        return max(self.scores, key=lambda e: (self.scores[e], -_PRIORITY_INDEX.get(e, 99)))

    @property
    def intensity(self) -> str:
        d = self.dominant
        return _intensity(self.scores[d]) if d else "منخفض"

    def active(self, min_score: int = 1) -> "list[str]":
        items = [e for e, s in self.scores.items() if s >= min_score]
        return sorted(items, key=lambda e: (-self.scores[e], _PRIORITY_INDEX.get(e, 99)))

    def label(self) -> str:
        """وصف مختصر: «إحباط (مرتفع) · استعجال»، أو "" لو محايد."""
        d = self.dominant
        if not d:
            return ""
        rest = [e for e in self.active() if e != d]
        head = f"{d} ({self.intensity})"
        return head + (" · " + " · ".join(rest) if rest else "")


@dataclass(frozen=True)
class EmotionPoint:
    index: int
    role: str
    reading: EmotionReading
    snippet: str


@dataclass(frozen=True)
class EmotionTimeline:
    points: "list[EmotionPoint]"
    trend: str
    peak: "EmotionPoint | None"


class EmotionEngine:
    """يكتشف مشاعر النص المصري ويبني خطاً زمنياً لتغيّرها عبر المكالمة."""

    def __init__(self, lexicon_path: "str | os.PathLike | None" = None) -> None:
        self.path = self._resolve_path(lexicon_path)
        self.version: int = 0
        self._marker_emotion: dict[str, str] = {}
        self._regex: "re.Pattern | None" = None
        self._sarcasm_regex: "re.Pattern | None" = None
        self.reload()

    @staticmethod
    def _resolve_path(path: "str | os.PathLike | None") -> Path:
        if path:
            return Path(path)
        env = os.getenv("SCM_EMOTION_LEXICON_PATH", "").strip()
        return Path(env) if env else _DEFAULT_LEXICON_PATH

    # ── التحميل ───────────────────────────────────────────────────────────
    def reload(self) -> None:
        raw = self._read()
        self.version = _as_int(raw.get("version"))
        marker_emotion: dict[str, str] = {}
        for emotion, markers in (raw.get("emotions") or {}).items():
            if not isinstance(emotion, str) or not isinstance(markers, list):
                continue
            for m in markers:
                if isinstance(m, str) and m.strip():
                    marker_emotion.setdefault(m.strip(), emotion.strip())
        self._marker_emotion = marker_emotion
        self._regex = _boundary_alt(marker_emotion.keys())

        cues = [c.strip() for c in (raw.get("sarcasm_cues") or [])
                if isinstance(c, str) and c.strip()]
        self._sarcasm_regex = _boundary_alt(cues)

        logger.info("[Emotion] حُمّل معجم v%s — %d عبارة · %d إشارة تهكّم (%s)",
                    self.version, len(marker_emotion), len(cues), self.path.name)

    def _read(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("جذر المعجم ليس كائن JSON")
            return data
        except FileNotFoundError:
            logger.warning("[Emotion] الملف غير موجود (%s) — محرّك بلا معجم.", self.path)
        except Exception as e:                              # noqa: BLE001
            logger.warning("[Emotion] تعذّر قراءة %s (%s) — محرّك بلا معجم.", self.path, e)
        return {}

    # ── التحليل ───────────────────────────────────────────────────────────
    def analyze(self, text: str) -> EmotionReading:
        """يحلّل نصّ دور واحد ويعيد قراءة المشاعر (آمن ضد الأخطاء)."""
        if not text or self._regex is None:
            return EmotionReading({})
        try:
            scores: dict[str, int] = defaultdict(int)
            seen: set[str] = set()
            for m in self._regex.finditer(text):
                marker = m.group(1)
                if marker in seen or _negated_before(text, m.start()):
                    continue
                seen.add(marker)
                scores[self._marker_emotion[marker]] += 1
            # تهكّم سياقي: مديح ساخر + غضب/إحباط في نفس الدور.
            if self._sarcasm_regex is not None and self._sarcasm_regex.search(text):
                if scores.get("غضب") or scores.get("إحباط"):
                    scores[_SARCASM] += 1
            return EmotionReading(dict(scores))
        except Exception as e:                              # noqa: BLE001
            logger.debug("[Emotion] تخطّي التحليل (%s)", e)
            return EmotionReading({})

    def realtime_hint(self, text: str) -> str:
        """تلميح شعوري مختصر للدور الأخير — يظهر فقط لو الشعور الغالب مُنبِّه (سلبي)."""
        r = self.analyze(text)
        d = r.dominant
        if not d or d not in _ALERTING:
            return ""
        return "قراءة شعورية للدور الأخير: " + r.label()

    def timeline(self, transcript: str) -> EmotionTimeline:
        """يبني خطاً زمنياً لمشاعر العميل من نصّ المكالمة المُسمّى بالأدوار."""
        turns = _parse_turns(transcript)
        customer = [(i, r, t) for i, (r, t) in enumerate(turns) if r == "العميل"]
        focus = customer or [(i, r, t) for i, (r, t) in enumerate(turns)]
        points: list[EmotionPoint] = []
        for i, role, text in focus:
            reading = self.analyze(text)
            if not reading.is_neutral():
                points.append(EmotionPoint(i, role, reading, text[:50]))
        peak = max(points, key=lambda p: _neg_weight(p.reading), default=None)
        if peak is not None and _neg_weight(peak.reading) == 0:
            peak = None
        return EmotionTimeline(points=points, trend=_trend(points), peak=peak)

    def timeline_hint(self, transcript: str) -> str:
        """كتلة خط زمني مختصرة لحقنها في برومبت التقرير، أو "" لو مفيش إشارات."""
        tl = self.timeline(transcript)
        if not tl.points:
            return ""
        lines = ["تتبّع مشاعر العميل عبر المكالمة (من كلامه):"]
        start, end = tl.points[0], tl.points[-1]
        lines.append(f"- البداية: {start.reading.label()}")
        if tl.peak is not None and tl.peak not in (start, end):
            lines.append(f"- الأبرز: {tl.peak.reading.label()} («{tl.peak.snippet}»)")
        if end is not start:
            lines.append(f"- النهاية: {end.reading.label()}")
        lines.append(f"- الاتجاه: {tl.trend}")
        return "\n".join(lines)


# ── مساعدات ─────────────────────────────────────────────────────────────────
def _boundary_alt(keys) -> "re.Pattern | None":
    keys = sorted({k for k in keys if k}, key=len, reverse=True)   # الأطول أولاً
    if not keys:
        return None
    alt = "|".join(re.escape(k) for k in keys)
    # نسمح ببادئة نحوية واحدة (و/ف/ب/ك/ل) قبل العبارة عشان نلتقط «ومحدش»، «وبسرعة»،
    # «فزهقت»... (اللاصقات المصرية الشائعة) — مع بقاء حدّ الكلمة قبل البادئة نفسها.
    return re.compile(r"(?<!\w)[وفبكل]?(" + alt + r")(?!\w)")


def _negated_before(text: str, start: int) -> bool:
    prefix = text[:start].rstrip()
    if not prefix:
        return False
    return _NONWORD_RE.sub("", prefix.split()[-1]) in _NEG_TOKENS


def _neg_weight(r: EmotionReading) -> int:
    return sum(s for e, s in r.scores.items() if e in _NEGATIVE)


def _pos_weight(r: EmotionReading) -> int:
    return sum(s for e, s in r.scores.items() if e in _POSITIVE)


def _trend(points: "list[EmotionPoint]") -> str:
    """اتجاه المشاعر: تصاعد سلبي / تحسّن بالنهاية / مستقر (حتمي من الأوزان)."""
    if len(points) < 2:
        return "مستقر"
    mid = len(points) // 2
    first = sum(_neg_weight(p.reading) for p in points[:mid])
    second = sum(_neg_weight(p.reading) for p in points[mid:])
    ends_positive = any(_pos_weight(p.reading) > 0 for p in points[-2:])
    if second < first and (ends_positive or second == 0):
        return "تحسّن بحلول نهاية المكالمة"
    if second > first:
        return "تصاعد سلبي عبر المكالمة"
    return "مستقر"


def _parse_turns(transcript: str) -> "list[tuple[str, str]]":
    turns: list[tuple[str, str]] = []
    for line in (transcript or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        m = _LINE_RE.match(line)
        turns.append((m.group("role").strip(), m.group("text").strip()) if m else ("", line))
    return turns


def _as_int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


# ── Singleton افتراضي ───────────────────────────────────────────────────────
_default_engine: "EmotionEngine | None" = None


def get_engine() -> EmotionEngine:
    """يعيد المحرّك الافتراضي المشترك (يُبنى كسولاً)."""
    global _default_engine
    if _default_engine is None:
        _default_engine = EmotionEngine()
    return _default_engine


def analyze(text: str) -> EmotionReading:
    """اختصار: يحلّل عبر المحرّك الافتراضي."""
    return get_engine().analyze(text)


def realtime_hint(text: str) -> str:
    """اختصار: تلميح شعوري للدور الأخير عبر المحرّك الافتراضي."""
    return get_engine().realtime_hint(text)


def timeline_hint(transcript: str) -> str:
    """اختصار: كتلة الخط الزمني للتقرير عبر المحرّك الافتراضي."""
    return get_engine().timeline_hint(transcript)
