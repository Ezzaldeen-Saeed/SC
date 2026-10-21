"""
config.py — إعدادات المشروع المركزية
──────────────────────────────────────
يقرأ .env ويُعرض ثوابت مكتوبة بوضوح.

⚙️ النظام محلي بالكامل: التفريغ عبر faster-whisper محلياً، والتحليل/التقارير عبر
   LM Studio / Ollama محلياً. لا يوجد أي استدعاء API خارجي (لا Deepgram/Groq/Gemini).
"""

import logging
import os
from pathlib import Path

# حاول تحميل .env إذا كانت python-dotenv مثبّتة
try:
    from dotenv import load_dotenv
    _env = Path(__file__).parent / ".env"
    load_dotenv(dotenv_path=_env, override=False)
except ImportError:
    pass

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
#  Whisper — محرّك التفريغ المحلي الوحيد (faster-whisper / CTranslate2)
# ══════════════════════════════════════════════════════════════════════════════
# النموذج: large-v3 هو الأقوى والأدقّ للعربية (المصرية) محلياً. أسماء بديلة أخفّ:
#   large-v3 (أقوى) · medium · small · base · tiny (أسرع/أضعف).
# ملاحظة GPU: على كارت 8GB يتقاسمه موديل الـ LLM، large-v3 بـ int8_float16 (~3GB)
#   خيار ممتاز (دقّة كاملة عملياً). لو الكارت مُخصّص لـ Whisper وحده استخدم float16.
WHISPER_MODEL: str        = os.getenv("WHISPER_MODEL",        "large-v3")
# مسار مجلّد CT2 محلي (لو نزّلت النموذج مسبقاً) — أولوية أعلى من الاسم. فارغ = تنزيل تلقائي.
WHISPER_LOCAL_MODEL_PATH: str = os.getenv("WHISPER_LOCAL_MODEL_PATH", "")

# الجهاز: auto (GPU لو متاح وإلا CPU) · cuda · cpu.
WHISPER_DEVICE: str       = os.getenv("WHISPER_DEVICE",       "auto").lower()
# نوع الحساب: فارغ = تلقائي (cuda→int8_float16، cpu→int8). بدائل cuda: float16 (أعلى دقّة،
#   ذاكرة أكبر) · int8_float16 (موازنة ممتازة). على CPU استخدم int8.
WHISPER_COMPUTE_TYPE: str = os.getenv("WHISPER_COMPUTE_TYPE", "")

# لغة التفريغ. Whisper يستخدم رمز ISO عام: "ar" للعربية (يشمل المصرية) — مفيش "ar-EG".
WHISPER_LANGUAGE: str     = os.getenv("WHISPER_LANGUAGE",     "ar")

# عدد الحزم (beam): الحيّ للدقّة اللحظية، التقرير أعلى لأقصى دقّة (رفع دقّة التفريغ).
# ملاحظة أداء: beam أعلى = أدقّ وأبطأ. لو الحيّ بقى بطيء على GPU مشترك، قلّله (3) عبر .env.
WHISPER_BEAM_SIZE: int    = int(os.getenv("WHISPER_BEAM_SIZE",   "5"))   # الحيّ
WHISPER_REPORT_BEAM: int  = int(os.getenv("WHISPER_REPORT_BEAM", "10"))  # التقرير

# نموذج التقرير — الافتراضي نفس النموذج الحيّ (تحميل واحد). اضبطه لموديل أقوى لو أردت.
WHISPER_REPORT_MODEL: str      = os.getenv("WHISPER_REPORT_MODEL", WHISPER_MODEL)
WHISPER_REPORT_MODEL_PATH: str = os.getenv("WHISPER_REPORT_MODEL_PATH", "")

# خيوط/عمّال CTranslate2 على CPU (تُتجاهل عملياً على GPU).
WHISPER_CPU_THREADS: int  = int(os.getenv("WHISPER_CPU_THREADS", "4"))
WHISPER_NUM_WORKERS: int  = int(os.getenv("WHISPER_NUM_WORKERS", "1"))

# Hotwords — مصطلحات يُرجّحها Whisper لرفع دقّة تعرّفه على لغة الكول سنتر (أسماء شركات،
# مصطلحات تقنية، ألفاظ خدمة العملاء). تُمرَّر كسلسلة واحدة. تجاوز عبر .env بقائمة مفصولة
# بمسافات/فواصل. اتركه فارغاً لاستخدام القائمة الافتراضية أدناه (مُحسّنة لاتصالات مصر).
_DEFAULT_HOTWORDS: list[str] = [
    # شركات/علامات تجارية
    "فودافون", "اتصالات", "أورنج", "وي", "المصرية للاتصالات", "ماي وي",
    # خدمة العملاء والشكاوى
    "خدمة العملاء", "الدعم الفني", "شكوى", "استفسار", "تذكرة", "رقم الشكوى", "رقم مرجعي",
    # الفوترة والاشتراكات
    "فاتورة", "باقة", "رصيد", "اشتراك", "تجديد", "سداد", "مديونية", "متأخرات",
    # الإنترنت والمسائل التقنية
    "راوتر", "مودم", "واي فاي", "فايبر", "إنترنت", "الشبكة", "تقطيع", "إعادة تشغيل",
    "باسورد", "تطبيق", "شريحة", "خط", "رقم الموبايل", "سرعة النت",
    # التحقق من الهوية
    "الرقم القومي", "البطاقة", "كود التحقق",
]
WHISPER_HOTWORDS: str = os.getenv("WHISPER_HOTWORDS", "") or " ".join(_DEFAULT_HOTWORDS)
# ملاحظة: whisper_service يدمج هذه القائمة مع مصطلحات القاموس المصري (company_terms)
# القابلة للتحرير بدون كود — فتقدر تزوّد hotwords من egyptian_dictionary.json مباشرةً.


# ══════════════════════════════════════════════════════════════════════════════
#  دقّة Whisper المتقدّمة — كلها اختيارية بقيم افتراضية آمنة (رفع الدقّة للمصري)
# ══════════════════════════════════════════════════════════════════════════════
# best_of: عدد المرشّحين عند العيّنات الحرارية (temperature>0) — أعلى = أدقّ/أبطأ قليلاً.
WHISPER_BEST_OF: int = int(os.getenv("WHISPER_BEST_OF", "8"))
# patience: صبر البحث الشعاعي (beam) — >1 يوسّع البحث فيرفع الدقّة (تكلفة زمن بسيطة).
WHISPER_PATIENCE: float = float(os.getenv("WHISPER_PATIENCE", "2.0"))
# repetition_penalty: يعاقب تكرار التوكن (>1) — يقلّل هلوسة التكرار الشائعة في العربية.
WHISPER_REPETITION_PENALTY: float = float(os.getenv("WHISPER_REPETITION_PENALTY", "1.15"))
# أزمنة الكلمات: تفعّل احتمال (ثقة) كل كلمة لتحليل الثقة. التقرير يفعّلها دائماً (يحتاجها).
# أطفئها للحيّ فقط (WHISPER_WORD_TIMESTAMPS=false) لو احتجت أقصى سرعة — لا يؤثّر على التقرير.
WHISPER_WORD_TIMESTAMPS: bool = os.getenv("WHISPER_WORD_TIMESTAMPS", "true").lower() == "true"

# VAD: أقصر مدّة صمت تُعتبر فاصلاً — قُلّلت (500→250) لمكالمات الكول سنتر السريعة فيتقسّم
# الكلام أدقّ وتتحسّن أزمنة الكلمات وفصل الأدوار. speech_pad كافٍ حتى لا يُقصّ أول/آخر الكلام.
WHISPER_VAD_MIN_SILENCE_MS: int = int(os.getenv("WHISPER_VAD_MIN_SILENCE_MS", "250"))
WHISPER_VAD_SPEECH_PAD_MS: int  = int(os.getenv("WHISPER_VAD_SPEECH_PAD_MS", "400"))

# initial_prompt: يُمهّد Whisper بسياق وأسلوب المكالمة المصرية (لهجة + مصطلحات الخدمة)
# فيرفع دقّة التعرّف والتزام العامية ويقلّل الانجراف للفصحى. عدّله عبر .env أو سيب الافتراضي.
_DEFAULT_INITIAL_PROMPT: str = (
    "تفريغ مكالمة خدمة عملاء مصرية بالعامية بين موظف وعميل. "
    "مصطلحات متكررة: النت فاصل، الراوتر بيقطع، الفاتورة، الباقة، الرصيد، الاشتراك، "
    "بلاغ، رقم مرجعي، تحقق الهوية، فودافون، اتصالات، أورنج، وي. "
    "اكتب الكلام بالعامية المصرية زي ما اتقال."
)
WHISPER_INITIAL_PROMPT: str = os.getenv("WHISPER_INITIAL_PROMPT", "") or _DEFAULT_INITIAL_PROMPT

# تحليل الثقة (Confidence): عتبات تحديد المقطع «منخفض الثقة» من مقاييس Whisper نفسها.
# أي مقياس يتجاوز عتبته ⇒ المقطع مرشّح لإعادة تفريغ تكيّفية أدقّ.
WHISPER_CONF_LOGPROB_MIN: float     = float(os.getenv("WHISPER_CONF_LOGPROB_MIN", "-1.0"))
WHISPER_CONF_COMPRESSION_MAX: float = float(os.getenv("WHISPER_CONF_COMPRESSION_MAX", "2.4"))
WHISPER_CONF_NO_SPEECH_MAX: float   = float(os.getenv("WHISPER_CONF_NO_SPEECH_MAX", "0.6"))
WHISPER_CONF_MIN_WORD_PROB: float   = float(os.getenv("WHISPER_CONF_MIN_WORD_PROB", "0.35"))

# إعادة التفريغ التكيّفية (Adaptive Re-Transcription) — للتقرير فقط: تعيد تفريغ المقاطع
# منخفضة الثقة *وحدها* بإعدادات أدقّ وتستبدل النص لو تحسّنت ثقته (حفاظ على الأداء — لا
# نعيد المكالمة كلها). RETRANSCRIBE_MAX = سقف عدد المقاطع المُعاد تفريغها لكل تقرير.
WHISPER_ADAPTIVE_RETRANSCRIBE: bool = os.getenv("WHISPER_ADAPTIVE_RETRANSCRIBE", "true").lower() == "true"
WHISPER_RETRANSCRIBE_BEAM: int      = int(os.getenv("WHISPER_RETRANSCRIBE_BEAM", "10"))
WHISPER_RETRANSCRIBE_MAX: int       = int(os.getenv("WHISPER_RETRANSCRIBE_MAX", "12"))


# ── تنظيف التفريغ (pipeline.text_cleaner) — منظّف حتمي، الخطوة 3 ────────────────
# ينظّف مخرجات Whisper (تكرار/مسافات/ترقيم + تصحيحات القاموس المصري) مع الحفاظ على
# اللهجة كما هي (بلا فصحنة). آمن وسريع (بلا LLM ولا شبكة). أطفئه (false) للرجوع للنص
# الخام تماماً أو للمقارنة. القاموس قابل للتحرير بدون كود:
#   pipeline/dictionary/egyptian_dictionary.json  (أو وجّه SCM_DICTIONARY_PATH لملف خارجي).
TEXT_CLEANER_ENABLED: bool = os.getenv("TEXT_CLEANER_ENABLED", "true").lower() == "true"


# ── مفسّر اللهجة المصرية (pipeline.dialect) — تلميحات ضمنية للبرومبت، الخطوة 4 ──
# يكتشف تعبيرات مصرية (هحاول/ربنا يسهل/هشوف...) ويحقن معناها الضمني في برومبت التحليل
# والتقرير فيفهم الموديل المقصود (مثلاً «هحاول» = وعد ضعيف مش إنجاز). حتمي وسريع (بلا LLM
# إضافي). المعجم قابل للتحرير بدون كود: pipeline/dialect/dialect_lexicon.json
#   (أو وجّه SCM_DIALECT_LEXICON_PATH لملف خارجي). أطفئه (false) لتعطيل حقن التلميحات.
DIALECT_INTERPRETER_ENABLED: bool = os.getenv("DIALECT_INTERPRETER_ENABLED", "true").lower() == "true"


# ── محرّك المشاعر المصري (pipeline.emotion) — قراءة شعورية + خط زمني، الخطوة 8 ──
# يكتشف ١١ شعوراً (غضب/إحباط/حيرة/خوف/توتر/رضا/حماس/تردد/تهكّم/استعجال/ثقة) من كلام
# العميل، ويحقن قراءة الدور في التحليل اللحظي وخطاً زمنياً للمشاعر في التقرير — فيتحسّن
# customer_sentiment واللحظات الحرجة. حتمي وسريع (بلا LLM). المعجم قابل للتحرير بدون كود:
#   pipeline/emotion/emotion_lexicon.json (أو SCM_EMOTION_LEXICON_PATH). أطفئه (false) للتعطيل.
EMOTION_ENGINE_ENABLED: bool = os.getenv("EMOTION_ENGINE_ENABLED", "true").lower() == "true"


# ══════════════════════════════════════════════════════════════════════════════
#  LLM — LM Studio / Ollama محلياً (OpenAI-compatible) — لا سحابة
# ══════════════════════════════════════════════════════════════════════════════
LLM_BACKEND: str       = os.getenv("LLM_BACKEND",     "ollama").lower()
OLLAMA_BASE_URL: str   = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:1234/v1")
LLM_MODEL: str         = os.getenv("LLM_MODEL",       "qwen2.5-7b-instruct")
LLM_MAX_TOKENS: int    = int(os.getenv("LLM_MAX_TOKENS",  "512"))
LLM_TEMPERATURE: float = float(os.getenv("LLM_TEMPERATURE", "0.2"))

# محرّك التحليل اللحظي — نفس الموديل المحلي افتراضياً (كله محلي).
REALTIME_BASE_URL: str = os.getenv("REALTIME_BASE_URL", OLLAMA_BASE_URL)
REALTIME_MODEL: str    = os.getenv("REALTIME_MODEL",    LLM_MODEL)
REALTIME_API_KEY: str  = os.getenv("REALTIME_API_KEY",  "not-needed")

# تصحيح نص التفريغ (ASR) بنموذج لغوي — محلي. يصلح أخطاء التعرّف الصوتي من السياق.
# يحتاج نموذجاً قوياً ليُفيد؛ فعّله بعد تحميل موديل مناسب في LM Studio.
CORRECTION_ENABLED: bool = os.getenv("CORRECTION_ENABLED", "false").lower() == "true"
CORRECTION_MODEL: str    = os.getenv("CORRECTION_MODEL", LLM_MODEL)
CORRECTION_BASE_URL: str = os.getenv("CORRECTION_BASE_URL", OLLAMA_BASE_URL)
CORRECTION_API_KEY: str  = os.getenv("CORRECTION_API_KEY", "not-needed")

# نموذج التقارير + حالة العميل — محلي (نفس الموديل افتراضياً).
REPORT_MODEL: str    = os.getenv("REPORT_MODEL", LLM_MODEL)
REPORT_BASE_URL: str = os.getenv("REPORT_BASE_URL", OLLAMA_BASE_URL)
REPORT_API_KEY: str  = os.getenv("REPORT_API_KEY", "not-needed")


# ── Discord ────────────────────────────────────────────────────────────────
DISCORD_TOKEN: str = os.getenv("DISCORD_TOKEN", "")
# ينضم البوت تلقائياً لأي قناة صوتية بمجرد دخول أول شخص (تجربة لحظية)
AUTO_JOIN: bool    = os.getenv("AUTO_JOIN", "true").lower() == "true"


# ── Server ─────────────────────────────────────────────────────────────────
HOST:   str  = os.getenv("HOST",   "0.0.0.0")
PORT:   int  = int(os.getenv("PORT",   "8080"))
RELOAD: bool = os.getenv("RELOAD", "false").lower() == "true"


# ── Misc ───────────────────────────────────────────────────────────────────
MAX_HISTORY_TURNS: int = int(os.getenv("MAX_HISTORY_TURNS", "20"))

# تشخيص: احفظ كل مقطع صوتي يُرسل لـ Whisper في _debug_audio/ لفحصه
DEBUG_DUMP_AUDIO: bool = os.getenv("DEBUG_DUMP_AUDIO", "false").lower() == "true"


# ── Validation ─────────────────────────────────────────────────────────────
def validate() -> bool:
    """النظام محلي بالكامل — لا مفاتيح API مطلوبة. نُحذّر فقط لو ينقص التوكن للبوت."""
    warnings: list[str] = []

    if not DISCORD_TOKEN:
        warnings.append("DISCORD_TOKEN فاضي — السيرفر يعمل لكن بوت Discord متوقّف.")

    for w in warnings:
        logger.warning("CONFIG: %s", w)

    logger.info(
        "Config ✅ — Whisper=%s (%s, %s) | LLM=%s @ %s",
        WHISPER_MODEL, WHISPER_DEVICE, WHISPER_LANGUAGE, LLM_MODEL, OLLAMA_BASE_URL,
    )
    return True
