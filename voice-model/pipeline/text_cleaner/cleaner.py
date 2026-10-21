"""
Text Cleaner — منظّف تفريغ حتمي للعامية المصرية (الخطوة 3)
──────────────────────────────────────────────────────────────
تنظيف حتمي (بلا LLM، بلا تأخير يُذكر) لمخرجات Whisper: يشيل التكرار، يظبط
المسافات والترقيم، ويصحّح أخطاء تفريغ آمنة من القاموس المصري — *مع الحفاظ على
اللهجة المصرية زي ما هي*. لا يحوّل العامية لفصحى إطلاقاً، ولا يغيّر المعنى.

أمثلة:
    «انا هابعتلك الفلوس بكره»  →  «أنا هبعتلك الفلوس بكرة.»
    «تمام يا باشا»            →  «تمام يا باشا»        (كما هي — بلا فصحنة)
    «ياااا باشا»              →  «يا باشا»             (تطبيع الإطالة)
    «النت النت مقطوع»          →  «النت مقطوع»          (إزالة تكرار الكلمة)

مبادئ التصميم:
  • حتمي وسريع — عمليات صرفة قابلة للاختبار، بلا أي نداء شبكة/LLM.
  • آمن ضد الأخطاء — أي استثناء داخلي ⇒ يُعاد النص الأصلي بلا تعديل.
  • حقن تبعية — القاموس والإعدادات تُمرَّر (CleanerConfig) فيسهل اختباره ومعايرته.
  • القواعد العامة (مسافات/تطويل/ترقيم/تكرار) دايماً آمنة للمعنى؛ والاستبدالات
    الكلمية تأتي من القاموس المُدار من المشرف (تحكّم في الدقّة/المخاطرة).
"""
from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass

from pipeline.dictionary import EgyptianDictionary, get_dictionary

logger = logging.getLogger("pipeline.text_cleaner")

_TATWEEL = "ـ"            # محرف التطويل ـ (تنسيقي بحت — إزالته آمنة دائماً)
# محارف صفرية العرض + علامات الاتجاه (ثنائي الاتجاه) — ضجيج تفريغ يُزال بأمان.
_ZERO_WIDTH_RE = re.compile(r"[​-‏‪-‮⁦-⁩﻿]")
_SPACE_RE = re.compile(r"[ \t ]+")       # مسافات/جدولة/مسافة غير فاصلة (nbsp)
_NL_RE = re.compile(r" *\n *")
_SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([،؛.؟?!])")
_REPEAT_PUNCT_RE = re.compile(r"([؟?!،؛])\1+")
_MULTI_DOT_RE = re.compile(r"\.{2,}")
_NONWORD_RE = re.compile(r"[^\w]", re.UNICODE)   # يشيل الترقيم/التشكيل للمقارنة فقط
_TERMINAL_CHARS = ".؟?!…،؛:"


@dataclass(frozen=True)
class CleanerConfig:
    """إعدادات المنظّف — كل عملية قابلة للإطفاء على حدة (معايرة واختبار)."""
    remove_tatweel: bool = True
    collapse_letter_runs: bool = True
    min_letter_run: int = 3               # عدد تكرار الحرف الذي يُعتبر إطالة (٣ فأكثر)
    normalize_whitespace: bool = True
    apply_dictionary: bool = True
    collapse_word_repeats: bool = True
    normalize_punctuation: bool = True
    add_terminal_punctuation: bool = True
    min_words_for_terminal: int = 4       # نضيف نقطة للجُمل (≥٤ كلمات) لا للتعبيرات القصيرة


class TextCleaner:
    """منظّف نصوص التفريغ. مرّر قاموساً و/أو إعدادات لتخصيص السلوك."""

    def __init__(self, dictionary: "EgyptianDictionary | None" = None,
                 config: "CleanerConfig | None" = None) -> None:
        self._dict = dictionary if dictionary is not None else get_dictionary()
        self.config = config or CleanerConfig()
        self._letter_run_re = self._build_letter_run_re()
        self._replace_re = self._build_replace_re()

    def _build_letter_run_re(self) -> "re.Pattern":
        # حرف (لا رقم/تشكيل) متبوع بنفسه (min_letter_run-1) مرة فأكثر ⇒ إطالة.
        n = max(1, self.config.min_letter_run - 1)
        return re.compile(r"([^\W\d_])\1{%d,}" % n)

    def _build_replace_re(self) -> "re.Pattern | None":
        # نبني بديل alternation بحدود كلمات عربية-آمنة؛ الأطول أولاً (عبارات قبل كلمات).
        keys = [k for k in self._dict.replacements if k and not self._dict.is_protected(k)]
        keys.sort(key=len, reverse=True)
        if not keys:
            return None
        alt = "|".join(re.escape(k) for k in keys)
        return re.compile(r"(?<!\w)(" + alt + r")(?!\w)")

    def rebuild(self) -> None:
        """يعيد بناء الأنماط بعد تعديل الإعدادات أو إعادة تحميل القاموس (reload)."""
        self._letter_run_re = self._build_letter_run_re()
        self._replace_re = self._build_replace_re()

    # ── الواجهة العامة ────────────────────────────────────────────────────
    def clean(self, text: str) -> str:
        """ينظّف نصّ تفريغ ويعيده. آمن: يعيد النص الأصلي عند أي خطأ داخلي."""
        if not text or not text.strip():
            return text
        cfg = self.config
        try:
            s = self._normalize_unicode(text)
            if cfg.remove_tatweel:
                s = s.replace(_TATWEEL, "")
            if cfg.collapse_letter_runs:
                s = self._letter_run_re.sub(r"\1", s)
            if cfg.normalize_whitespace:
                s = self._normalize_ws(s)
            if cfg.apply_dictionary and self._replace_re is not None:
                s = self._replace_re.sub(self._replace, s)
            if cfg.collapse_word_repeats:
                s = self._collapse_repeats(s)
            if cfg.normalize_punctuation:
                s = self._normalize_punct(s)
            if cfg.normalize_whitespace:
                s = self._normalize_ws(s)
            if cfg.add_terminal_punctuation:
                s = self._add_terminal(s)
            return s.strip()
        except Exception:                       # النظافة لا تُسقط التفريغ أبداً
            logger.exception("[TextCleaner] فشل التنظيف — يُعاد النص الأصلي")
            return text

    __call__ = clean

    # ── خطوات داخلية (صرفة، قابلة للاختبار) ───────────────────────────────
    @staticmethod
    def _normalize_unicode(s: str) -> str:
        """توحيد NFC وإزالة المحارف صفرية العرض/علامات الاتجاه (ضجيج تفريغ)."""
        s = unicodedata.normalize("NFC", s)
        return _ZERO_WIDTH_RE.sub("", s)

    @staticmethod
    def _normalize_ws(s: str) -> str:
        s = _SPACE_RE.sub(" ", s)
        s = _NL_RE.sub("\n", s)
        return s.strip()

    def _replace(self, m: "re.Match") -> str:
        return self._dict.replacements.get(m.group(1), m.group(1))

    def _collapse_repeats(self, s: str) -> str:
        """يدمج تكرار الكلمة المتتالي (تأتأة التفريغ): «النت النت» ← «النت». يعمل سطراً سطراً."""
        out_lines: list[str] = []
        for line in s.split("\n"):
            kept: list[str] = []
            for tok in line.split():
                if kept and self._same_word(tok, kept[-1]):
                    continue
                kept.append(tok)
            out_lines.append(" ".join(kept))
        return "\n".join(out_lines)

    @staticmethod
    def _same_word(a: str, b: str) -> bool:
        """تطابق كلمتين تجاهلاً للترقيم/التشكيل (للكشف عن التكرار المتتالي)."""
        ca = _NONWORD_RE.sub("", a)
        cb = _NONWORD_RE.sub("", b)
        return bool(ca) and ca == cb

    @staticmethod
    def _normalize_punct(s: str) -> str:
        s = _SPACE_BEFORE_PUNCT_RE.sub(r"\1", s)   # «كده ؟» ← «كده؟»
        s = _REPEAT_PUNCT_RE.sub(r"\1", s)         # «؟؟؟» ← «؟»
        s = _MULTI_DOT_RE.sub("…", s)              # «..» ← «…»
        return s

    def _add_terminal(self, s: str) -> str:
        """يضيف نقطة ختامية للجُمل الطويلة فقط (لا للتعبيرات القصيرة زي «تمام يا باشا»)."""
        t = s.rstrip()
        if not t or len(t.split()) < self.config.min_words_for_terminal:
            return s
        if t[-1] in _TERMINAL_CHARS:
            return s
        return t + "."


# ── Singleton افتراضي + دوال ملائمة ────────────────────────────────────────
_default_cleaner: "TextCleaner | None" = None


def get_cleaner() -> TextCleaner:
    """يعيد المنظّف الافتراضي المشترك (قاموس افتراضي، يُبنى كسولاً)."""
    global _default_cleaner
    if _default_cleaner is None:
        _default_cleaner = TextCleaner()
    return _default_cleaner


def clean_transcript(text: str) -> str:
    """نظّف نصّ تفريغ باستخدام المنظّف الافتراضي — الواجهة اللي يستدعيها whisper_service."""
    return get_cleaner().clean(text)
