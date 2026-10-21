"""
Egyptian Arabic Dictionary — طبقة القاموس المصري القابلة للتحرير (الخطوة 11)
─────────────────────────────────────────────────────────────────────────────
قاموس بيانات واحد قابل للتحرير من المشرفين *بدون تعديل الكود*. يخدم عدّة طبقات:
  • text_cleaner (الخطوة 3): يستهلك replacements (spelling_variants + asr_corrections)
    لتصحيح إملائي/أخطاء تفريغ آمنة — بلا تحويل اللهجة لفصحى وبلا تغيير المعنى.
  • dialect interpreter (الخطوة 4، لاحقاً): يستهلك slang (تعبير ← معنى ضمني).
  • transcription (الخطوة 2، لاحقاً): company_terms كـ hotwords لتحيّز Whisper.

القاموس بيانات صرفة (JSON): عدّل pipeline/dictionary/egyptian_dictionary.json
مباشرةً، أو وجّه متغيّر البيئة SCM_DICTIONARY_PATH لملف خارجي. أعِد التحميل بـ reload().

تصميم دفاعي: أي ملف ناقص/تالف ⇒ قاموس فارغ + تحذير (لا يكسر التفريغ إطلاقاً).
مستقلّ تماماً: لا يعتمد على config ولا على أي مكتبة ثقيلة (stdlib فقط) — قابل للاختبار.
"""
from __future__ import annotations

import json
import logging
import os
from collections.abc import Iterable
from pathlib import Path

logger = logging.getLogger("pipeline.dictionary")

_DEFAULT_PATH = Path(__file__).with_name("egyptian_dictionary.json")


def _resolve_path(path: "str | os.PathLike | None") -> Path:
    """أولوية المسار: وسيط صريح ← متغيّر البيئة SCM_DICTIONARY_PATH ← الملف المرفق."""
    if path:
        return Path(path)
    env = os.getenv("SCM_DICTIONARY_PATH", "").strip()
    return Path(env) if env else _DEFAULT_PATH


class EgyptianDictionary:
    """قاموس مصري مُحمّل من JSON — آمن ضد الملفات الناقصة/التالفة وقابل لإعادة التحميل."""

    def __init__(self, path: "str | os.PathLike | None" = None) -> None:
        self.path = _resolve_path(path)
        self.version: int = 0
        self.asr_corrections: dict[str, str] = {}
        self.spelling_variants: dict[str, str] = {}   # بديل ← صحيح (مقلوب عند التحميل)
        self.replacements: dict[str, str] = {}        # المدمج اللي يستهلكه المنظّف
        self.protected: frozenset[str] = frozenset()
        self.slang: dict[str, str] = {}
        self.company_terms: list[str] = []
        self.phonetic: dict[str, str] = {}
        self.abbreviations: dict[str, str] = {}
        self.reload()

    # ── التحميل ───────────────────────────────────────────────────────────
    def reload(self) -> None:
        """يعيد تحميل القاموس من القرص (للتحديث الإداري بدون إعادة تشغيل)."""
        raw = self._read()
        self.version = _as_int(raw.get("version"))
        self.asr_corrections = _clean_map(raw.get("asr_corrections"))
        self.spelling_variants = _invert_variants(raw.get("spelling_variants"))
        self.protected = frozenset(_clean_list(raw.get("protected_terms")))
        self.slang = _clean_map(raw.get("slang"))
        self.company_terms = _clean_list(raw.get("company_terms"))
        self.phonetic = _clean_map(raw.get("phonetic"))
        self.abbreviations = _clean_map(raw.get("abbreviations"))

        # المدمج: المتغيّرات الإملائية أولاً ثم تصحيحات ASR (لها الأولوية عند التعارض)،
        # مع استبعاد أي مصدر محميّ أو مطابق لهدفه (بلا تغيير فعلي) — أمان إضافي.
        merged: dict[str, str] = {}
        for src, dst in {**self.spelling_variants, **self.asr_corrections}.items():
            if not src or not dst or src == dst or src in self.protected:
                continue
            merged[src] = dst
        self.replacements = merged

        logger.info(
            "[Dictionary] حُمّل v%s — %d استبدال · %d محميّ · %d عامية · %d مصطلح شركة (%s)",
            self.version, len(self.replacements), len(self.protected),
            len(self.slang), len(self.company_terms), self.path.name,
        )

    def _read(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("جذر القاموس ليس كائن JSON")
            return data
        except FileNotFoundError:
            logger.warning("[Dictionary] الملف غير موجود (%s) — قاموس فارغ.", self.path)
        except Exception as e:
            logger.warning("[Dictionary] تعذّر قراءة %s (%s) — قاموس فارغ.", self.path, e)
        return {}

    # ── واجهات الاستعلام ──────────────────────────────────────────────────
    def is_protected(self, term: str) -> bool:
        """هل هذا التعبير محميّ (ممنوع المنظّف يغيّره)؟"""
        return term in self.protected

    def meaning(self, term: str) -> "str | None":
        """المعنى الضمني لتعبير عامي (لمفسّر اللهجة — الخطوة 4)، أو None."""
        return self.slang.get(term)

    def hotwords(self) -> str:
        """مصطلحات الشركة كسلسلة hotwords لتحيّز Whisper (للخطوة 2 لاحقاً)."""
        return " ".join(self.company_terms)


# ── مساعدات تنظيف البيانات (تتسامح مع مدخلات غير مثالية من ملف يحرّره بشر) ──────
def _as_int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _clean_map(obj) -> dict[str, str]:
    """يقبل {str:str} فقط، ويشذّب المفاتيح/القيم الفارغة."""
    if not isinstance(obj, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in obj.items():
        if isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip():
            out[k.strip()] = v.strip()
    return out


def _clean_list(obj) -> list[str]:
    """يقبل قائمة نصوص، يشذّب الفراغات ويزيل التكرار مع حفظ الترتيب."""
    if not isinstance(obj, list):
        return []
    seen: dict[str, None] = {}
    for x in obj:
        if isinstance(x, str) and x.strip():
            seen[x.strip()] = None
    return list(seen.keys())


def _invert_variants(obj) -> dict[str, str]:
    """{الصحيح: [أشكال بديلة]} ← {بديل: الصحيح}. يتجاهل المدخلات غير الصالحة بهدوء."""
    if not isinstance(obj, dict):
        return {}
    out: dict[str, str] = {}
    for canon, variants in obj.items():
        if not isinstance(canon, str) or not canon.strip():
            continue
        canon = canon.strip()
        if isinstance(variants, str):
            variants = [variants]
        elif not isinstance(variants, Iterable):
            continue
        for v in variants:
            if isinstance(v, str) and v.strip() and v.strip() != canon:
                out[v.strip()] = canon
    return out


# ── Singleton افتراضي ───────────────────────────────────────────────────────
_default_dictionary: "EgyptianDictionary | None" = None


def get_dictionary() -> EgyptianDictionary:
    """يعيد القاموس الافتراضي المشترك (يُحمّل مرة واحدة كسولاً)."""
    global _default_dictionary
    if _default_dictionary is None:
        _default_dictionary = EgyptianDictionary()
    return _default_dictionary
