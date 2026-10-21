"""
SCM speech-intelligence pipeline — حزمة معالجة الكلام المعيارية (الخطوة 12)
──────────────────────────────────────────────────────────────────────────
حزمة إضافية (additive) تُحسّن مسار التفريغ/التحليل الحالي *بدون كسر أي شيء*.
كل وحدة مستقلة وقابلة للاختبار، وتُدمج في الكود القائم خلف إعدادات (flags).

الوحدات المتاحة حالياً:
  • dictionary   — قاموس مصري قابل للتحرير من المشرفين (الخطوة 11).
  • text_cleaner — منظّف تفريغ حتمي يحافظ على اللهجة (الخطوة 3).
  • dialect      — مفسّر اللهجة المصرية للمقصود الضمني (الخطوة 4).
  • emotion      — محرّك مشاعر مصري (١١ شعور) + خط زمني (الخطوة 8).

وحدات قادمة (context / intent / entities ...) هتتضاف هنا بنفس النمط:
مستقلّة، محقونة التبعية، ومغلّفة بإعداد تشغيل.
"""
from __future__ import annotations

__version__ = "0.3.0"

# إعادة تصدير مريحة (استيرادات خفيفة — stdlib فقط، بلا مكتبات ثقيلة).
from .dialect import DialectHint, EgyptianDialectInterpreter, get_interpreter
from .dictionary import EgyptianDictionary, get_dictionary
from .emotion import EmotionEngine, EmotionReading, EmotionTimeline, get_engine
from .text_cleaner import CleanerConfig, TextCleaner, clean_transcript, get_cleaner

__all__ = [
    "__version__",
    "EgyptianDictionary",
    "get_dictionary",
    "TextCleaner",
    "CleanerConfig",
    "clean_transcript",
    "get_cleaner",
    "EgyptianDialectInterpreter",
    "DialectHint",
    "get_interpreter",
    "EmotionEngine",
    "EmotionReading",
    "EmotionTimeline",
    "get_engine",
]
