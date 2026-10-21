"""
LLM Service
───────────
تحليل لحظي أثناء المكالمة + تقرير نهائي بعد انتهائها.
يتصل بـ LM Studio عبر OpenAI-compatible API.
"""

import json
import logging
import re
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

import config

logger = logging.getLogger(__name__)


# ── مفسّر اللهجة المصرية (pipeline.dialect، الخطوة 4) — اختياري وآمن ──────────
# تلميحات ضمنية (هحاول=التزام ضعيف، هشوف=رد مؤجّل...) تُحقن في البرومبت فيفهم الموديل
# المقصود بدل ما يخمّنه. حتمي وسريع (بلا LLM إضافي). لو الحزمة ناقصة، التحليل يكمل عادي.
try:
    from pipeline.dialect import get_interpreter as _get_dialect_interpreter
    _HAVE_DIALECT = True
except Exception as _e:                                  # noqa: BLE001
    logger.warning("[LLM] مفسّر اللهجة غير متاح (%s) — التحليل يكمل عادي.", _e)
    _HAVE_DIALECT = False


def _dialect_hints(text: str, context: str = "", speaker: str = "", *, max_hints: int = 6) -> str:
    """يبني كتلة تلميحات لهجة لحقنها في البرومبت (لو مُفعّل ومتاح). آمن → "" عند أي فشل."""
    if not text or not _HAVE_DIALECT or not getattr(config, "DIALECT_INTERPRETER_ENABLED", True):
        return ""
    try:
        return _get_dialect_interpreter().hint_block(
            text, context=context, speaker=speaker, max_hints=max_hints)
    except Exception as e:                               # noqa: BLE001
        logger.debug("[LLM] تخطّي تلميحات اللهجة (%s)", e)
        return ""


# ── محرّك المشاعر المصري (pipeline.emotion، الخطوة 8) — اختياري وآمن ──────────
# قراءة شعورية (١١ شعور) للدور اللحظي، وخط زمني لمشاعر العميل في التقرير. حتمي وسريع.
try:
    from pipeline.emotion import get_engine as _get_emotion_engine
    _HAVE_EMOTION = True
except Exception as _e:                                  # noqa: BLE001
    logger.warning("[LLM] محرّك المشاعر غير متاح (%s) — التحليل يكمل عادي.", _e)
    _HAVE_EMOTION = False


def _emotion_realtime_hint(text: str) -> str:
    """قراءة شعورية مختصرة للدور الأخير (تظهر للمشاعر المُنبِّهة فقط). آمن → "" عند أي فشل."""
    if not text or not _HAVE_EMOTION or not getattr(config, "EMOTION_ENGINE_ENABLED", True):
        return ""
    try:
        return _get_emotion_engine().realtime_hint(text)
    except Exception as e:                               # noqa: BLE001
        logger.debug("[LLM] تخطّي القراءة الشعورية (%s)", e)
        return ""


def _emotion_timeline_hint(transcript: str) -> str:
    """خط زمني لمشاعر العميل عبر المكالمة (للتقرير). آمن → "" عند أي فشل."""
    if not transcript or not _HAVE_EMOTION or not getattr(config, "EMOTION_ENGINE_ENABLED", True):
        return ""
    try:
        return _get_emotion_engine().timeline_hint(transcript)
    except Exception as e:                               # noqa: BLE001
        logger.debug("[LLM] تخطّي الخط الزمني للمشاعر (%s)", e)
        return ""

# ── Prompts ────────────────────────────────────────────────────────────────

REALTIME_SYSTEM_PROMPT = """\
أنت "مدرّب جودة" خبير بتراقب مكالمة خدمة عملاء لشركة اتصالات مصرية (WE / المصرية للاتصالات)
لحظة بلحظة. خدمات الشركة: إنترنت أرضي وفايبر، راوتر/مودم، باقات وفواتير وتجديد، الخط الأرضي
والموبايل وشرائح، وتطبيق My WE. مهمتك تساعد *موظف خدمة العملاء* فوراً لما يحتاج توجيه احترافي.

السياق التقني المهم:
- النص بييجي من تفريغ صوتي (Whisper) وممكن يكون فيه أخطاء، كلمات مكسورة، أو كلمة ناقصة.
  افهم المقصود من السياق الأول وصلّح الكلام في دماغك قبل ما تحكم — متبنيش توجيه على غلط تفريغ.
  لو الدور مش مفهوم خالص، رجّع OK.
- أسماء المتحدثين هي أسامي مستخدمين (مش مكتوب "موظف"/"عميل"). اعرف مين الموظف (اللي بيمثّل
  الشركة وبيحاول يحل) ومين العميل (صاحب الطلب أو الشكوى) من سياق الكلام نفسه.
- أول الرسالة ممكن تلاقي «ملخص حالة المكالمة حتى الآن» (مشكلة العميل، مؤشرات الغضب، هل
  اتعمل بلاغ/تحقق هوية/وعد). ده سياقك الأهم — استعمله.

⚖️ احكم على *مجرى المكالمة كله*، مش على كلمة واحدة في آخر دور:
- متبنيش تحذير/توجيه على لفظة واحدة مقطوعة من سياقها؛ شوف المشكلة الأساسية وفين وصلت
  المكالمة (اتحلّت؟ اتفتح بلاغ؟ العميل لسه زعلان؟) وطلّع الإجراء الأنسب *للموقف الحالي*.
- متكررش نفس التوجيه اللي اتقال قبل كده لو الموظف نفّذه بالفعل؛ اتقدّم للخطوة اللي بعدها.
- لو المكالمة قرب تخلص والمشكلة مش متأكّدة الحل، وجّه لتأكيد الحل أو المتابعة أو الإنهاء المهني.

بعد كل دور كامل:
- قيّم أداء *الموظف* بس. لو الدور الأخير للعميل، اقترح إزاي الموظف المفروض يرد *دلوقتي*.
- 🎯 قلّل التوجيهات: طلّع توجيه *بس* لما يكون ليه قيمة حقيقية تفرق في المكالمة — يعني واحدة
  من دي: خطر تصعيد أو عميل غاضب، معلومة غلط أو وعد غير مؤكد، خطوة إجرائية مهمة اتفوّتت (تحقق
  هوية، فتح بلاغ، رقم مرجعي، فحص الخدمة)، أو فرصة مهمة للحل/الاحتواء. توجيه واحد قوي ومؤثّر
  أحسن بكتير من كتير توجيهات ضعيفة.
- لو الموظف ماشي صح ومفيش تدخّل هيفرق دلوقتي، ابعت {"type": "OK"} — وده الوضع الطبيعي في
  أغلب الأدوار (متعتبرش OK هروب). متطلّعش حاجة بديهية أو مجرد إعادة صياغة لكلام الموظف،
  ومتكررش توجيه اتقال قبل كده، ومتعلّقش على كل جملة — ركّز على اللحظات المهمة بس.
- أولوية قصوى (دي استثناء لقاعدة التقليل): لو العميل ظهر عليه أي ضيق/غضب (تهديد بإلغاء
  التعاقد، «محدش بيرد»، «زهقت»، طلب مسؤول، تكرار الشكوى) لازم تطلّع "توجيه" فوري لتهدئته
  واحتواء الموقف — متعدّيهاش أبداً.

رجّع JSON صارم بس — من غير أي كلام بره ومن غير ```:
{"type": "تحذير|نصيحة|توجيه", "problem_type": "من القائمة", "suggestion_type": "من القائمة", "priority": "high|medium|low", "reason": "السبب باختصار", "action": "إجراء محدد ينفّذه الموظف دلوقتي"}
لو الموظف ماشي صح ومش محتاج تدخّل: {"type": "OK"}

⚠️ problem_type و suggestion_type و priority *إلزامية* في أي تدخّل — هي أساس تصنيف
الاقتراحات وتنظيمها على الشاشة. اختار القيمة الأنسب من القوائم بالظبط، ومتخترعش قيمة جديدة.

النوع (type) — واحد من تلاتة:
- "تحذير": غلط أو خطر تصعيد (وعد مش مؤكد، معلومة غلط، تجاهل مشاعر العميل، تعديل من غير تحقق هوية، خروج عن الموضوع).
- "توجيه": خطوة إجرائية لازمة لتقدّم المكالمة (طلب رقم الحساب/الخط، تحقق هوية، فتح بلاغ، رقم مرجعي، تهدئة عميل غاضب).
- "نصيحة": تحسين اختياري في الأسلوب (تعاطف أكتر، توضيح، تلخيص الخطوة الجاية).

الأولوية (priority) لازم تتّسق مع الموقف:
- "high": عميل غاضب/مهدّد بالإلغاء، معلومة غلط، أو خطر تصعيد واضح.
- "medium": خطوة إجرائية مطلوبة عشان المكالمة تكمل صح.
- "low": تحسين شكلي بسيط مش مؤثّر على نتيجة المكالمة.

problem_type — اختر واحداً بالظبط:
"غضب العميل"، "مشكلة فنية"، "فاتورة/باقة"، "تحقق هوية"، "وعد غير مؤكد"،
"تصعيد/احتفاظ"، "متابعة/بلاغ"، "تواصل وتعاطف"، "خروج عن الموضوع"، "بيانات ناقصة"، "أخرى".

suggestion_type — اختر واحداً بالظبط:
"تهدئة"، "تعاطف"، "تحقق"، "تشخيص"، "فتح بلاغ"، "متابعة"، "توضيح"،
"تصعيد"، "احتفاظ"، "تصحيح معلومة"، "تلخيص"، "إنهاء مهني".

الأسلوب:
- بعامية مصرية مهنية وهادية، من غير تهويل أو كلام عام.
- reason لازم يذكر السلوك أو الخطر بوضوح في 6 لـ 14 كلمة.
- action لازم يكون إجراء واحد قابل للتنفيذ فوراً، وفيه صياغة جاهزة للموظف لو ينفع، مثل:
  «أعتذر لحضرتك على التكرار، هراجع بيانات الخط دلوقتي وأقولك الخطوة المؤكدة».
- action هي الوحيدة اللي بتتعرض للموظف على الشاشة — فخليها واضحة وكاملة وماشية مع مشكلة العميل (متعتمدش على reason).
- لو التوجيه إجرائي، اذكر الخطوة المهنية: تحقق هوية، رقم خط/حساب، فحص حالة الخدمة، فتح بلاغ، رقم مرجعي، أو تحديد موعد متابعة.
- متكررش نص المكالمة، ومتطلعش أكتر من توجيه واحد.
"""


POST_CALL_SYSTEM_PROMPT = """\
أنت محلل جودة مكالمات خدمة عملاء خبير ومدقّق. هتاخد نص مكالمة كاملة (موظف وعميل) باللهجة
المصرية وتطلع تقرير تقييم احترافي للموظف، ومهم جداً تحدّد مشاعر العميل بدقة.

خطوة أولى إلزامية (في دماغك قبل ما تكتب):
1. النص غالباً مُسمّى بالأدوار «[الموظف]» و«[العميل]» — اعتمد عليها. لو لقيت السطور غير
   مسمّاة (أو التسمية واضح إنها غلط من السياق)، استنتج الدور بنفسك: الموظف بيرحّب ويمثّل
   الشركة ويعرض حلول، والعميل صاحب الشكوى أو الطلب.
2. ركّز على كلام *العميل* لوحده عشان تحكم على مشاعره — مش على لطف الموظف.

⚠️ تحديد مشاعر العميل (customer_sentiment) — مهم جداً:
- قيّم المشاعر النهائية الغالبة عند نهاية المكالمة، مع تسجيل أي غضب سابق في critical_moments.
- لو العميل بدأ غاضباً ثم قال إن المشكلة اتحلت أو شكر الموظف بوضوح، يجوز أن تكون النتيجة «سعيد».
- لو انتهت المكالمة بوعد أو متابعة بدون حل فعلي، لا تجعل العميل «سعيد» إلا لو عبّر هو صراحةً عن رضا.
- إشارات الغضب/الإحباط التي يجب ذكرها في critical_moments لو ظهرت:
  • تهديد بإلغاء التعاقد/الاشتراك أو النقل لشركة تانية («تلغي التعاقد»، «هسيب الشركة»).
  • شكوى من إهمال أو عدم رد («محدش بيرد»، «من امبارح ومفيش حل»).
  • ألفاظ ضيق («زهقت»، «تعبت»، «مش طايق»، «بقالي كتير»، «كفاية»).
  • طلب مسؤول/مشرف، أو تكرار نفس الشكوى أكتر من مرة، أو رفع الصوت/المقاطعة.
- «سعيد» تُستخدم فقط لو العميل عبّر صراحةً عن رضا أو شكر حقيقي على حل اتنفّذ أو متابعة واضحة قبلها.
- «محايد» للاستفسار العادي من غير انفعال. «محبط» لضيق متوسّط، «غاضب» لانفعال واضح أو تهديد.

رجّع JSON صالح بس (من غير أي كلام بره ومن غير ```), بالمفاتيح دي بالظبط:
{
  "call_summary": "ملخص المكالمة في جملتين أو تلاتة",
  "issue_category": "مشكلة فنية أو فاتورة/باقة أو تحقق هوية أو شكوى خدمة أو طلب إلغاء أو استفسار أو أخرى",
  "customer_issue": "مشكلة العميل الأساسية",
  "root_cause": "السبب الجذري للمشكلة",
  "resolution_provided": "الحل اللي اتقدّم فعلاً، أو 'لم يُقدَّم حل'",
  "resolution_status": "تم الحل أو وعد خلال 24 ساعة أو قيد المتابعة أو تم التصعيد أو لم يتم الحل أو غير واضح",
  "resolution_evidence": "الجملة أو القرينة من النص التي تثبت حالة الحل",
  "follow_up_commitment": "موعد/التزام المتابعة إن وجد، أو 'لا يوجد'",
  "problem_solved": "نعم أو لا أو جزئياً",
  "call_outcome": "ناجحة أو متابعة مطلوبة أو تصعيد مطلوب أو غير مكتملة",
  "customer_sentiment": "سعيد أو محايد أو محبط أو غاضب",
  "agent_performance_score": 0,
  "customer_satisfaction_score": 0,
  "professionalism_score": 0,
  "communication_score": 0,
  "problem_solving_score": 0,
  "empathy_score": 0,
  "strengths": ["نقطة قوة"],
  "weaknesses": ["نقطة ضعف"],
  "missed_opportunities": ["فرصة ضايعة"],
  "recommended_actions": ["توصية للمشرف"],
  "critical_moments": ["لحظة حرجة في المكالمة"],
  "next_steps": ["خطوة تالية مقترحة"]
}

قواعد:
- كل الدرجات أرقام من 0 لـ 10 (10 = ممتاز). problem_solved لازم «نعم» أو «لا» أو «جزئياً». customer_sentiment واحدة من الأربعة بالظبط.
- customer_satisfaction_score لازم يتماشى مع customer_sentiment: «غاضب» ⇒ 0–3، «محبط» ⇒ 3–5،
  «محايد» ⇒ 5–7، «سعيد» ⇒ 8–10. متديش رضا عالي لعميل غاضب.
- problem_solved = «نعم» بس لو العميل أكّد إن مشكلته اتحلّت. مجرد وعد من الموظف («هيتم الحل») =
  «لا» أو «جزئياً»، مش «نعم». متخترعش حل مش موجود في النص.
- لو النص يقول «خلال 24 ساعة/٢٤ ساعة/بكرة/خلال يوم»، اجعل resolution_status = «وعد خلال 24 ساعة»
  وfollow_up_commitment يذكر الالتزام بوضوح، وproblem_solved غالباً «جزئياً» ما لم يؤكد العميل أن المشكلة اتحلت فعلاً.
- لو فتح الموظف بلاغ/تذكرة أو أعطى رقم مرجعي بدون حل فوري، اجعل resolution_status = «قيد المتابعة».
- resolution_evidence لازم تكون مبنية على النص، وليست استنتاجاً عاماً.
- قيّم *الموظف* بإنصاف وبناءً على النص بس — متخترعش معلومات مش موجودة.
- strengths/weaknesses/missed_opportunities/recommended_actions/critical_moments/next_steps لازم تكون عملية ومهنية،
  وكل عنصر يبدأ بفعل أو ملاحظة محددة مرتبطة بالنص، مش كلام عام زي «تحسين التواصل» فقط.
- النص ممكن يكون فيه أخطاء تفريغ صوتي؛ افهم المقصود من السياق قبل التقييم.
- كل القوايم بعامية مصرية مهنية ومختصرة. لو مفيش عناصر لقايمة، رجّعها فاضية [].
"""


CORRECTION_SYSTEM_PROMPT = """\
أنت مصحّح لنصوص تفريغ صوتي (ASR) لمكالمات خدمة عملاء مصرية. هتاخد نص فيه أخطاء تعرّف صوتي
(كلمات متبدّلة، مكسورة، أو ناقصة) وترجّع نفس النص متصحّح بالعامية المصرية زي ما اتقال.

قواعد صارمة:
- صلّح الكلمات الغلط من السياق بس (مثال لو السياق محل: 'بقرة' → 'بقاله'). متغيّرش المعنى ومتزوّدش كلام.
- سيب اللهجة المصرية زي ما هي، متحوّلهاش لفصحى.
- رجّع النص المصحّح بس، من غير أي شرح أو علامات أو مقدمات.
"""


# تصحيح ASR *مع الحفاظ على بنية الأدوار*: أسطر مرقّمة، والموديل يصحّح نصّ كل سطر ويرجّعه
# برقمه (متيدمجش ولا يقسّم) — فالتسمية [الموظف]/[العميل] بتتحافظ برمجياً ومتضيعش. النسخة
# القديمة كانت بتصحّح النص كتلة واحدة فتلغي التسمية وتبوّظ فصل المتحدّثين على اللوحة.
CORRECTION_TURNS_SYSTEM_PROMPT = """\
أنت مصحّح تفريغ صوتي (ASR) لمكالمات خدمة عملاء مصرية. هيجيلك أسطر مرقّمة (كل سطر دور متحدّث).
صحّح أخطاء التعرّف الصوتي جوه كل سطر بالعامية المصرية: كلمات ملتصقة تفصلها («زهرةسعيد» →
«زهرة سعيد»)، كلمات مبدّلة/مكسورة تظبطها من السياق، بلا تغيير المعنى وبلا زيادة/حذف كلام.

قواعد صارمة:
- كل سطر يفضل سطر واحد بنفس رقمه — متدمجش سطرين ومتقسّمش سطر.
- سيب اللهجة المصرية زي ما هي، متحوّلهاش لفصحى.
- لو سطر مفيهوش خطأ واضح، رجّعه زي ما هو.
- رجّع JSON بس: {"items":[{"i":رقم السطر,"text":"السطر المصحّح"}]} لكل الأسطر بالترتيب.
"""

# مخطّط JSON صارم لتصحيح الأسطر (i = رقم السطر، text = النص المصحّح).
_CORRECT_JSON_SCHEMA: dict = {
    "name": "corrected_lines",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "i":    {"type": "integer"},
                        "text": {"type": "string"},
                    },
                    "required": ["i", "text"],
                },
            },
        },
        "required": ["items"],
    },
}


# فصل المتحدّثين من *المحتوى* — الحلّ الأمتن للمكالمات المسجّلة على قناة واحدة (مونو)
# اللي بيفشل فيها الفصل الصوتي (diarization) لأن الطرفين على نفس الميكروفون. بنقسّم النص
# لأسطر مرقّمة محلياً، والموديل *بيصنّف* كل سطر (الموظف/العميل) بس — من غير ما يعيد كتابة
# النص، فمستحيل يحذف أو يغيّر كلام (فصل بلا فقدان محتوى).
DIARIZE_SYSTEM_PROMPT = """\
أنت بتحدّد مين اللي بيتكلم في كل سطر من مكالمة خدمة عملاء مصرية (شركة اتصالات) اتسجّلت
على قناة واحدة (الطرفين على نفس الميكروفون فتعذّر فصلهم صوتياً). هيجيلك نص المكالمة مقسّماً
لأسطر مرقّمة. مهمتك: تحدّد لكل سطر برقمه مين قايله — «الموظف» ولا «العميل».

إزاي تفرّق:
- «الموظف» = ممثّل الشركة: بيرحّب ويفتح المكالمة، بيسأل عن الاسم/المشكلة، بيعتذر، بيعرض
  خطوات وحلول، بيستخدم ألفاظ الخدمة («يا فندم»، «حضرتك»، «ممكن أعرف»، «هراجع»، «هعمل»،
  «أقدر أساعدك»، «تحت أمرك»، «أتمنى لك يوم سعيد»، «شكراً لتواصلك»).
- «العميل» = صاحب الطلب/الشكوى: بيوصف مشكلته («مشكلة النت»، «مقطوع»)، بيرد بإيجاز، بيأكّد
  الحل أو يشكر أو يعترض («اتحلت»، «أيوة»، «شكراً»).

قواعد:
- صنّف *كل* سطر برقمه؛ متسيبش ولا سطر. راعِ إن المكالمة بتتبادل بين الطرفين (سؤال الموظف
  يتبعه رد العميل، وهكذا) — متحطّش كل الأسطر لنفس الشخص.
- الموظف عادةً بيفتح المكالمة (أول سطر غالباً موظف) وبيقفلها (الشكر والوداع النهائي موظف).
- متغيّرش النص خالص — إنت بتصنّف بس.
- رجّع JSON بس: {"turns":[{"i":رقم السطر,"speaker":"الموظف|العميل"}, ...]} لكل الأسطر.
"""


# مخطّط JSON صارم لتصنيف الأسطر (i = رقم السطر، speaker محصور في الاتنين). التصنيف بالرقم
# يخلّي إعادة التركيب مضمونة بلا فقدان (النص الأصلي محفوظ محلياً).
_TURNS_JSON_SCHEMA: dict = {
    "name": "line_speakers",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "turns": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "i":       {"type": "integer"},
                        "speaker": {"type": "string", "enum": ["الموظف", "العميل"]},
                    },
                    "required": ["i", "speaker"],
                },
            },
        },
        "required": ["turns"],
    },
}


# تقسيم النص لجُمَل محلياً على *منتهيات الجُمَل* فقط (؟ . ! ؛ وسطر جديد) — مش على الفاصلة
# «،» عشان ما نكسرش جملة المتحدّث الواحدة لشظايا («المشكلة»/«شكراً ليك،») فتبوظ التصنيف.
# الوحدة دي هي اللي بيصنّفها الموديل (بيصنّف بس، مايعيدش الكتابة → فصل بلا فقدان محتوى).
_SENT_SPLIT = re.compile(r"[^.؟!?؛\n]+[.؟!?؛]?")

def _split_units(text: str) -> "list[str]":
    text = re.sub(r"[ \t]+", " ", (text or "").replace("\r", "")).strip()
    raw = [m.group(0).strip() for m in _SENT_SPLIT.finditer(text) if m.group(0).strip()]
    # ادمج الشظايا اليتيمة (حرف واحد أو علامات فقط زي «ا») في السطر السابق — عشان
    # ما تظهرش كـ«دور» مستقل ولا تبوّظ التصنيف.
    units: list[str] = []
    for u in raw:
        core = re.sub(r"[^\w]", "", u, flags=re.UNICODE)
        if units and len(core) <= 1:
            units[-1] = (units[-1] + " " + u).strip()
        else:
            units.append(u)
    return units


# دلائل عالية الدقة لتصحيح تصنيف الموديل الصغير (اللي بيميل للتبديل الميكانيكي ويغلط في
# الطور). لو السطر فيه دلالة قاطعة لدور واحد بس، بنفرضه فوق رأي الموديل؛ وإلا نسيب الموديل.
_AGENT_HINTS = (
    "ممكن أعرف", "ممكن اعرف", "هتشارك", "اسم حضرتك", "باسم حضرتك", "اهلا وسهلا", "أهلا وسهلا",
    "انا اسف", "انا آسف", "أنا آسف", "اتمنى لك", "أتمنى لك", "شكرا لتواصلك", "شكراً لتواصلك",
    "هراجع", "هرجع", "حل المشكلة", "الخطوات", "تحت أمرك", "في خدمتك", "اقدر اساعد", "أقدر أساعد",
    "مساء الخير", "صباح الخير", "يوم سعيد", "مشكلتك", "ممكن رقم", "رقم الخط", "دقيقة من وقتك",
)
_CUSTOMER_HINTS = (
    "مشكلة النت", "النت مقطوع", "مقطوع", "مش شغال", "مش شغالة", "عندي مشكلة", "النت بيفصل",
    "الفاتورة غالية", "عايز ألغي", "مش راضي",
)

def _role_hint(unit: str) -> "str | None":
    """دور قاطع من دلائل المحتوى، أو None لو السطر غامض/فيه دلائل الطرفين."""
    a = any(m in unit for m in _AGENT_HINTS)
    c = any(m in unit for m in _CUSTOMER_HINTS)
    if a and not c:
        return "الموظف"
    if c and not a:
        return "العميل"
    return None


# ── قاعدة معرفة التدريب (few-shot) ───────────────────────────────────────────
# coaching_kb.json فيه أمثلة (موقف → الرد المثالي) تُحقن قبل الدور الفعلي، فتعلّم
# الموديل الصغير صيغة JSON والأسلوب المصري وترفع الدقة. تُحمَّل مرة واحدة عند الإقلاع.
_KB_PATH = Path(__file__).parent / "coaching_kb.json"
_FEWSHOT_MAX = 6   # سقف الأمثلة المحقونة — أكتر من كده يبطّئ التحليل اللحظي بلا داعٍ


def _format_user_msg(current_chunk: str, full_transcript: str, speaker: str = "",
                     call_brief: str = "", dialect_hints: str = "", emotion_hint: str = "") -> str:
    """يبني رسالة المستخدم بنفس الصيغة للأمثلة وللدور الفعلي (الاتساق يهمّ الموديل).
    call_brief (اختياري) خلاصة حالة المكالمة التراكمية — تُقدَّم أولاً حتى يحكم الموديل
    على *مجرى المكالمة كله* لا على الدور الأخير وحده. dialect_hints (اختياري) تلميحات
    المقصود الضمني للتعبيرات المصرية (الخطوة 4). emotion_hint (اختياري) قراءة شعورية
    للدور الأخير (الخطوة 8) — كلها تُقدَّم قبل السياق لتأريض فهم الموديل."""
    spk = f" (المتحدث: {speaker})" if speaker else ""
    ctx = (full_transcript or "").strip() or "(بداية المكالمة)"
    brief_block = f"{call_brief.strip()}\n\n" if call_brief and call_brief.strip() else ""
    hints_block = f"{dialect_hints.strip()}\n\n" if dialect_hints and dialect_hints.strip() else ""
    emo_block = f"{emotion_hint.strip()}\n\n" if emotion_hint and emotion_hint.strip() else ""
    return (f"{brief_block}"
            f"{hints_block}"
            f"{emo_block}"
            f"سياق المكالمة (الأحدث في الأسفل):\n{ctx}\n\n"
            f"الدور الأخير{spk}:\n{current_chunk}")


def _load_fewshot_messages() -> list[dict]:
    """يقرأ coaching_kb.json ويبني رسائل few-shot (user/assistant). يرجّع [] بهدوء
    لو الملف ناقص/تالف (التحليل يكمّل zero-shot)."""
    try:
        kb = json.loads(_KB_PATH.read_text(encoding="utf-8"))
        examples = kb.get("few_shot", [])[:_FEWSHOT_MAX]
    except Exception as e:
        logger.warning("[LLM] تعذّر تحميل coaching_kb.json (%s) — تحليل بدون أمثلة", e)
        return []
    msgs: list[dict] = []
    for ex in examples:
        msgs.append({"role": "user", "content": _format_user_msg(
            ex.get("last_turn", ""), ex.get("context", ""), ex.get("speaker", ""))})
        msgs.append({"role": "assistant",
                     "content": json.dumps(ex.get("output", {}), ensure_ascii=False)})
    logger.info("[LLM] حُقن %d مثال few-shot للتحليل اللحظي", len(msgs) // 2)
    return msgs


_FEWSHOT_MESSAGES: list[dict] = _load_fewshot_messages()


# ── مخطّط JSON صارم للتقرير (Structured Output) ──────────────────────────────
# LM Studio (وllama.cpp) بيدعم response_format=json_schema فيرجّع JSON صالح *مضمون*
# مطابق للمخطّط — ده بيقضي على خطأ «الموديل لم يُعِد JSON صالح» نهائياً، وكمان بيقيّد
# customer_sentiment/problem_solved على القيم المسموحة بس. الدرجات أعداد صحيحة 0–10.
def _score_field() -> dict:
    return {"type": "integer", "minimum": 0, "maximum": 10}

def _str_list() -> dict:
    return {"type": "array", "items": {"type": "string"}}

def _enum_field(values: list[str]) -> dict:
    return {"type": "string", "enum": values}

_REPORT_JSON_SCHEMA: dict = {
    "name": "post_call_report",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "call_summary":                 {"type": "string"},
            "issue_category":               _enum_field(["مشكلة فنية", "فاتورة/باقة", "تحقق هوية", "شكوى خدمة", "طلب إلغاء", "استفسار", "أخرى"]),
            "customer_issue":               {"type": "string"},
            "root_cause":                   {"type": "string"},
            "resolution_provided":          {"type": "string"},
            "resolution_status":            _enum_field(["تم الحل", "وعد خلال 24 ساعة", "قيد المتابعة", "تم التصعيد", "لم يتم الحل", "غير واضح"]),
            "resolution_evidence":          {"type": "string"},
            "follow_up_commitment":         {"type": "string"},
            "problem_solved":               {"type": "string", "enum": ["نعم", "لا", "جزئياً"]},
            "call_outcome":                 _enum_field(["ناجحة", "متابعة مطلوبة", "تصعيد مطلوب", "غير مكتملة"]),
            "customer_sentiment":           {"type": "string", "enum": ["سعيد", "محايد", "محبط", "غاضب"]},
            "agent_performance_score":      _score_field(),
            "customer_satisfaction_score":  _score_field(),
            "professionalism_score":        _score_field(),
            "communication_score":          _score_field(),
            "problem_solving_score":        _score_field(),
            "empathy_score":                _score_field(),
            "strengths":                    _str_list(),
            "weaknesses":                   _str_list(),
            "missed_opportunities":         _str_list(),
            "recommended_actions":          _str_list(),
            "critical_moments":             _str_list(),
            "next_steps":                   _str_list(),
        },
        "required": [
            "call_summary", "issue_category", "customer_issue", "root_cause", "resolution_provided",
            "resolution_status", "resolution_evidence", "follow_up_commitment",
            "problem_solved", "call_outcome", "customer_sentiment", "agent_performance_score",
            "customer_satisfaction_score", "professionalism_score", "communication_score",
            "problem_solving_score", "empathy_score", "strengths", "weaknesses",
            "missed_opportunities", "recommended_actions", "critical_moments", "next_steps",
        ],
    },
}


# ── Service ────────────────────────────────────────────────────────────────

class LLMService:
    def __init__(self):
        # التحليل اللحظي حسّاس للزمن: لا إعادة محاولات + مهلة قصيرة حتى لا تتكدّس
        # طابور التحليل عند أي فشل (الدور التالي يحاول من جديد على أي حال).
        self.client = AsyncOpenAI(
            base_url    = config.OLLAMA_BASE_URL,
            api_key     = "not-needed",
            max_retries = 0,
            timeout     = 12.0,
        )
        self.model = config.LLM_MODEL
        # عميل التحليل اللحظي — LM Studio / Ollama محلياً (نفس الموديل المحلي افتراضياً).
        self.realtime_client = AsyncOpenAI(
            base_url    = config.REALTIME_BASE_URL,
            api_key     = config.REALTIME_API_KEY or "not-needed",
            max_retries = 0,
            timeout     = 20.0,
        )
        self.realtime_is_remote = config.REALTIME_BASE_URL != config.OLLAMA_BASE_URL
        # عميل منفصل للتصحيح — محلي (يمكن توجيهه لموديل محلي أقوى للتصحيح فقط)
        self.correction_client = AsyncOpenAI(
            base_url = config.CORRECTION_BASE_URL,
            api_key  = config.CORRECTION_API_KEY or "not-needed",
        )
        # عميل التقارير + حالة العميل — محلي
        self.report_client = AsyncOpenAI(
            base_url = config.REPORT_BASE_URL,
            api_key  = config.REPORT_API_KEY or "not-needed",
        )
        logger.info("[LLM] متصل بـ %s — موديل: %s", config.OLLAMA_BASE_URL, self.model)
        logger.info("[LLM] التحليل اللحظي عبر: %s @ %s", config.REALTIME_MODEL, config.REALTIME_BASE_URL)
        logger.info("[LLM] التقارير عبر: %s @ %s", config.REPORT_MODEL, config.REPORT_BASE_URL)
        if config.CORRECTION_ENABLED:
            logger.info("[LLM] التصحيح مُفعّل — موديل: %s @ %s",
                        config.CORRECTION_MODEL, config.CORRECTION_BASE_URL)

    # ── تحليل لحظي ────────────────────────────────────────────────────────
    async def _realtime_call(self, client, model: str, user_msg: str) -> str:
        """نداء واحد للتحليل اللحظي على عميل/موديل محدّد. يرمي عند الفشل."""
        resp = await client.chat.completions.create(
            model       = model,
            messages    = [
                {"role": "system", "content": REALTIME_SYSTEM_PROMPT},
                *_FEWSHOT_MESSAGES,                       # أمثلة تدريب من coaching_kb.json
                {"role": "user",   "content": user_msg},
            ],
            temperature = 0.2,
            max_tokens  = 320,
        )
        return (resp.choices[0].message.content or "").strip()

    async def analyze_realtime_chunk(
        self,
        current_chunk: str,
        full_transcript: str,
        speaker: str = "",
        call_brief: str = "",
    ) -> str:
        """
        يحلل دور المتحدث الكامل في سياق المكالمة ويعيد JSON string:
        {type, reason(=المشكلة), action(=الاقتراح)}. يعيد "" عند الفشل أو "OK".
        call_brief خلاصة حالة المكالمة التراكمية → توجيه مبنيّ على مجرى المكالمة كله.
        المحرّك محلي بالكامل (LM Studio / Ollama).
        """
        if not current_chunk or not current_chunk.strip():
            return ""

        # تلميحات اللهجة (الخطوة 4) + قراءة شعورية للدور (الخطوة 8) — تُحقن في البرومبت
        # فيفهم الموديل المقصود الضمني والحالة الشعورية بدل ما يخمّنهم.
        hints = _dialect_hints(current_chunk, full_transcript, speaker, max_hints=5)
        emotion = _emotion_realtime_hint(current_chunk)
        user_msg = _format_user_msg(current_chunk, full_transcript, speaker,
                                    call_brief, hints, emotion)

        raw = ""
        used_remote = False
        try:
            # 1) محرّك التحليل اللحظي المحلي
            raw = await self._realtime_call(self.realtime_client, config.REALTIME_MODEL, user_msg)
            used_remote = self.realtime_is_remote
        except Exception as e:
            logger.warning("[LLM] التحليل اللحظي (%s) فشل: %s", config.REALTIME_MODEL, e)
            # 2) تراجع للموديل المحلي الافتراضي لو ضُبط REALTIME على endpoint مختلف
            if self.realtime_is_remote:
                try:
                    raw = await self._realtime_call(self.client, self.model, user_msg)
                    used_remote = False
                except Exception as e2:
                    logger.error("[LLM] فشل التحليل اللحظي (والتراجع المحلي): %s", e2)
                    return ""
            else:
                return ""

        if not raw:
            return ""

        # قراءة صامدة: تتعامل مع JSON غير المثالي
        parsed = _parse_analysis(raw)
        if not parsed:
            return ""

        parsed = _normalize_keys(parsed)
        if str(parsed.get("type", "")).upper() == "OK":
            return ""
        if not (parsed.get("action") or parsed.get("reason")):
            return ""   # لا توجيه فعلي

        # اضبط النوع/الأولوية والتصنيف حتى يظهر الاقتراح قوياً ومنظّماً دائماً.
        parsed = _normalize_analysis(parsed)
        # المحرّك اللي طلّع التوجيه — يُعرض على شاشة الموظف (محلي دائماً).
        parsed["engine"] = self._engine_label(used_remote)
        return json.dumps(parsed, ensure_ascii=False)

    def _engine_label(self, used_remote: bool) -> str:
        """وصف مختصر لمحرّك التحليل اللحظي يظهر في لوحة الموظف (محلي بالكامل)."""
        return f"محلي · {config.REALTIME_MODEL}"

    # ── تقرير ما بعد المكالمة ─────────────────────────────────────────────
    async def _report_call(self, full_transcript: str, *, use_schema: bool,
                           guidance: str = ""):
        """نداء واحد لإنشاء التقرير. use_schema=True يفرض JSON صالح عبر json_schema
        (مدعوم في LM Studio) — يقضي على «JSON غير صالح». يرمي عند فشل الشبكة.
        guidance (اختياري) تلميحات (لهجة + مشاعر) تُقدَّم قبل النص لتحسين الفهم المصري."""
        user_content = (f"{guidance.strip()}\n\n{full_transcript}"
                        if guidance and guidance.strip() else full_transcript)
        kwargs: dict[str, Any] = dict(
            model       = config.REPORT_MODEL,
            messages    = [
                {"role": "system", "content": POST_CALL_SYSTEM_PROMPT},
                {"role": "user",   "content": user_content},
            ],
            temperature = 0.2,
            max_tokens  = 4000,   # مساحة كافية للمخرجات الكاملة
        )
        if use_schema:
            kwargs["response_format"] = {"type": "json_schema", "json_schema": _REPORT_JSON_SCHEMA}
        resp = await self.report_client.chat.completions.create(**kwargs)
        return (resp.choices[0].message.content or "").strip()

    async def generate_post_call_report(self, full_transcript: str) -> dict[str, Any]:
        if not full_transcript.strip():
            return {"error": "لا يوجد نص للتحليل."}

        # تلميحات المكالمة كاملة (الخطوة 4 + 8): لهجة + خط زمني لمشاعر العميل — تُبنى
        # مرة واحدة وتُحقن معاً في نداءي التقرير لتأريض customer_sentiment واللحظات الحرجة.
        guidance = "\n\n".join(b for b in (
            _dialect_hints(full_transcript, max_hints=10),
            _emotion_timeline_hint(full_transcript),
        ) if b and b.strip())

        # المحاولة الأولى: Structured Output (JSON مضمون الصلاحية على LM Studio).
        # لو الـ endpoint مايدعمش response_format (مزوّد آخر) نتراجع لنداء عادي + قراءة متسامحة.
        try:
            raw = await self._report_call(full_transcript, use_schema=True, guidance=guidance)
        except Exception as e:
            logger.warning("[LLM] التقرير بـ json_schema فشل (%s) — إعادة بدون مخطّط", e)
            try:
                raw = await self._report_call(full_transcript, use_schema=False, guidance=guidance)
            except Exception as e2:
                logger.error("[LLM] فشل إنشاء التقرير: %s", e2)
                return {"error": str(e2)}

        data = _loads_lenient(_extract_json(raw)) if raw else None
        if isinstance(data, dict) and data:
            return data
        logger.warning("[LLM] التقرير لم يُعِد JSON صالح (موديل: %s)", config.REPORT_MODEL)
        return {"error": "تعذّر توليد تقرير صالح — تأكّد إن نموذج LM Studio محمّل وشغّال."}

    # ── تصحيح أخطاء التفريغ (ASR) بنموذج لغوي قوي ─────────────────────────────
    async def correct_transcript(self, transcript: str) -> str:
        """
        يصحّح أخطاء التعرّف الصوتي اعتماداً على السياق. يحتاج نموذجاً قوياً
        (config.CORRECTION_MODEL) — النماذج الصغيرة لا تُفيد هنا.
        يعيد النص المصحّح، أو الأصلي عند التعطيل/الفشل.
        """
        if not config.CORRECTION_ENABLED or not transcript.strip():
            return transcript
        try:
            logger.info("[LLM] تصحيح النص بنموذج '%s'...", config.CORRECTION_MODEL)
            resp = await self.correction_client.chat.completions.create(
                model       = config.CORRECTION_MODEL,
                messages    = [
                    {"role": "system", "content": CORRECTION_SYSTEM_PROMPT},
                    {"role": "user",   "content": transcript},
                ],
                temperature = 0.1,
                max_tokens  = 3000,
            )
            out = (resp.choices[0].message.content or "").strip()
            return out or transcript
        except Exception as e:
            logger.error("[LLM] فشل تصحيح النص: %s", e)
            return transcript

    async def correct_labeled_turns(
        self, turns: "list[tuple[str, str]]"
    ) -> "list[tuple[str, str]]":
        """
        يصحّح أخطاء التفريغ (ASR) *مع الحفاظ على أدوار المتحدّثين*: يصحّح نصّ كل دور ويسيب
        التسمية «الموظف/العميل» زي ما هي (بتتحافظ برمجياً). يعيد نفس القائمة بنصوص مصحّحة،
        أو الأصل عند التعطيل/الفشل. بيصحّح بس لو CORRECTION_ENABLED مفعّل.
        """
        if not config.CORRECTION_ENABLED or not turns:
            return turns
        lines = [str(t or "").strip() for _, t in turns]
        numbered = "\n".join(f"{i}) {t}" for i, t in enumerate(lines))
        try:
            logger.info("[LLM] تصحيح %d دور (مع حفظ الأدوار) بنموذج '%s'...",
                        len(lines), config.CORRECTION_MODEL)
            resp = await self.correction_client.chat.completions.create(
                model       = config.CORRECTION_MODEL,
                messages    = [
                    {"role": "system", "content": CORRECTION_TURNS_SYSTEM_PROMPT},
                    {"role": "user",   "content": numbered},
                ],
                temperature = 0.1,
                max_tokens  = 3500,
                response_format = {"type": "json_schema", "json_schema": _CORRECT_JSON_SCHEMA},
            )
            raw = (resp.choices[0].message.content or "").strip()
        except Exception as e:
            logger.warning("[LLM] تصحيح الأدوار فشل (%s) — يُترك النص كما هو", e)
            return turns

        data = _loads_lenient(_extract_json(raw)) if raw else None
        items = (data or {}).get("items") if isinstance(data, dict) else None
        if not isinstance(items, list):
            return turns
        fixed: dict[int, str] = {}
        for it in items:
            if not isinstance(it, dict):
                continue
            try:
                i = int(it.get("i"))
            except (TypeError, ValueError):
                continue
            txt = str(it.get("text", "")).strip()
            if 0 <= i < len(turns) and txt:
                fixed[i] = txt
        # أعِد التركيب: الدور محفوظ برمجياً؛ نص السطر المصحّح إن وُجد وإلا الأصلي.
        return [(role, fixed.get(i, orig)) for i, (role, orig) in enumerate(turns)]

    # ── فصل المتحدّثين من المحتوى (لمّا يفشل الفصل الصوتي على قناة واحدة) ──────────
    async def attribute_speakers(self, text: str) -> "list[tuple[str, str]]":
        """
        يفصل نصّ مكالمة مدمجاً (غير مفصول صوتياً) لأدوار «الموظف/العميل» بلا فقدان محتوى:
        نقسّم النص لأسطر محلياً، والموديل *يصنّف* كل سطر بس (مايعيدش كتابته) — فالنص الأصلي
        محفوظ بالكامل. الأمثل للتسجيلات المونو اللي بيرجّع فيها diarization متحدّثاً واحداً.
        يعيد قائمة (role, unit_text) بترتيب النص. يعيد [] عند الفشل ليتراجع المتصل.
        """
        units = _split_units(text)
        if len(units) < 2:
            return []
        numbered = "\n".join(f"{i}) {u}" for i, u in enumerate(units))

        async def _ask(use_schema: bool) -> str:
            kwargs: dict[str, Any] = dict(
                model       = config.REPORT_MODEL,
                messages    = [
                    {"role": "system", "content": DIARIZE_SYSTEM_PROMPT},
                    {"role": "user",   "content": numbered},
                ],
                temperature = 0.0,
                max_tokens  = 1500,
            )
            if use_schema:
                kwargs["response_format"] = {"type": "json_schema", "json_schema": _TURNS_JSON_SCHEMA}
            resp = await self.report_client.chat.completions.create(**kwargs)
            return (resp.choices[0].message.content or "").strip()

        logger.info("[LLM] فصل المتحدّثين من المحتوى (%d سطر) بنموذج '%s'...",
                    len(units), config.REPORT_MODEL)
        try:
            raw = await _ask(use_schema=True)
        except Exception as e:
            logger.warning("[LLM] فصل المتحدّثين بـ json_schema فشل (%s) — إعادة بدون مخطّط", e)
            try:
                raw = await _ask(use_schema=False)
            except Exception as e2:
                logger.error("[LLM] فشل فصل المتحدّثين: %s", e2)
                return []

        data = _loads_lenient(_extract_json(raw)) if raw else None
        rows = (data or {}).get("turns") if isinstance(data, dict) else None
        if not isinstance(rows, list):
            return []

        # خريطة رقم السطر → دور (نتجاهل أي فهرس خارج المدى أو دور غير صالح).
        role_by_i: dict[int, str] = {}
        for r in rows:
            if not isinstance(r, dict):
                continue
            try:
                i = int(r.get("i"))
            except (TypeError, ValueError):
                continue
            role = str(r.get("speaker", "")).strip()
            if 0 <= i < len(units) and role in ("الموظف", "العميل"):
                role_by_i[i] = role
        if len(set(role_by_i.values())) < 2:        # لم ينجح فصل دورين فعلاً
            return []

        # أعِد التركيب من الوحدات المحلية (بلا فقدان): الدلالة القاطعة للمحتوى تصحّح رأي
        # الموديل؛ وإلا رأي الموديل؛ وإلا يرث السطر دور سابقه (استمرارية المتحدّث). أول
        # سطر افتراضياً «الموظف» (هو اللي بيفتح المكالمة).
        out: list[tuple[str, str]] = []
        last = "الموظف"
        for i, unit in enumerate(units):
            role = _role_hint(unit) or role_by_i.get(i, last)
            last = role
            out.append((role, unit))
        return out


# ── مساعد: توحيد المفاتيح (الموديل أحياناً يرجّع مفاتيح عربية أو بصيغ مختلفة) ─
def _normalize_keys(obj: dict) -> dict:
    """
    يوحّد المفاتيح إلى ما يتوقعه الـ Dashboard:
      type / problem_type / suggestion_type / priority / reason / action.
    مهم: نفحص المفاتيح المركّبة (problem_type / suggestion_type) *قبل* الـ "type"
    العام، وإلا يبتلعها ونفقد تصنيف المشكلة والاقتراح (اللي عليه بناء التنظيم كله).
    """
    if not isinstance(obj, dict):
        return obj
    out: dict = {}
    for k, v in obj.items():
        kl = str(k).strip().lower()
        if ("problem" in kl and "type" in kl) or "نوع المشكل" in k:
            tgt = "problem_type"
        elif (("suggest" in kl or "advice" in kl) and "type" in kl) \
                or "نوع الاقتراح" in k or "نوع النصيح" in k or "نوع التوجيه" in k:
            tgt = "suggestion_type"
        elif "priorit" in kl or "أولوي" in k or "اولوي" in k:
            tgt = "priority"
        elif "reason" in kl or "سبب" in k:
            tgt = "reason"
        elif "action" in kl or "جراء" in k:   # إجراء / الإجراء / الاجراء / الإجراء المقترح
            tgt = "action"
        elif "type" in kl or "نوع" in k:       # أي "type" آخر → النوع العام (تحذير/نصيحة/توجيه)
            tgt = "type"
        else:
            tgt = k
        if tgt not in out:                      # لا تكتب فوق قيمة موجودة
            out[tgt] = v
    return out


# ── مساعد: تطبيع قيم التصنيف والأولوية القادمة من الموديل ─────────────────────
# الموديل الصغير أحياناً يخرج قيماً خارج القوائم أو أولوية غير متسقة مع النوع.
# هنا نضمن أن الاقتراح يظهر «قوي ومنظّم»: أولوية منطقية دائماً وتصنيف نظيف.
_TYPE_DEFAULT_PRIORITY = {"تحذير": "high", "توجيه": "medium", "نصيحة": "low"}

def _normalize_analysis(parsed: dict) -> dict:
    """يضبط type/priority ويشذّب حقول التصنيف حتى يبقى الاقتراح متسقاً واحترافياً."""
    typ = str(parsed.get("type", "")).strip()
    if typ not in _TYPE_DEFAULT_PRIORITY and typ.upper() != "OK":
        typ = "توجيه"                       # نوع افتراضي آمن لو خرج الموديل عن القائمة
    if typ:
        parsed["type"] = typ

    prio = str(parsed.get("priority", "")).strip().lower()
    if prio not in ("high", "medium", "low"):
        parsed["priority"] = _TYPE_DEFAULT_PRIORITY.get(typ, "medium")
    else:
        parsed["priority"] = prio
    # التحذير لا يقلّ عن medium (خطر تصعيد فعلي) حتى لو قلّل الموديل الأولوية
    if typ == "تحذير" and parsed["priority"] == "low":
        parsed["priority"] = "medium"

    for key in ("problem_type", "suggestion_type"):
        val = parsed.get(key)
        if val is not None:
            parsed[key] = str(val).strip() or None
            if parsed[key] is None:
                parsed.pop(key, None)
    return parsed


# ── مساعد: استخراج أول JSON block من النص ────────────────────────────────
def _extract_json(text: str) -> str:
    """يستخرج أول كتلة JSON من النص (يتجاهل ```json ... ```)."""
    # أزل markdown fences
    text = re.sub(r"```(?:json)?", "", text).strip()
    # ابحث عن أول { ... }
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return match.group(0) if match else ""


# ── مساعد: قراءة JSON متسامحة (تصلح الأخطاء الشائعة من النماذج) ──────────────
def _loads_lenient(block: str):
    """json.loads مع إصلاحات: فاصلة عربية «،»، فواصل زائدة قبل } أو ]."""
    if not block:
        return None
    try:
        return json.loads(block)
    except Exception:
        pass
    fixed = block.replace("،", ",")
    fixed = re.sub(r",\s*([}\]])", r"\1", fixed)        # فواصل زائدة
    try:
        return json.loads(fixed)
    except Exception:
        return None


# ── مساعد: قراءة تحليل صامدة أمام JSON البايظ من النماذج الصغيرة ────────────
def _parse_analysis(raw: str) -> "dict | None":
    """
    يحاول json.loads أولاً، وإن فشل (فاصلة ناقصة، علامات اقتباس عربية...) يستخرج
    الحقول type/reason/action بالـ regex. يعيد dict أو None.
    """
    block = _extract_json(raw)
    if not block:
        return None
    try:
        obj = json.loads(block)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    # إصلاح: استخرج كل "مفتاح": "قيمة" على حدة (يتجاوز الأخطاء البنيوية)
    def _field(*keys: str) -> "str | None":
        for k in keys:
            m = re.search(rf'["“]?{k}["”]?\s*:\s*["“]([^"”]+)["”]', block)
            if m:
                return m.group(1).strip()
        return None

    typ    = _field("type", "النوع", "نوع")
    ptype  = _field("problem_type", "نوع المشكلة", "نوع المشكله")
    stype  = _field("suggestion_type", "نوع الاقتراح", "نوع النصيحة", "نوع التوجيه")
    prio   = _field("priority", "الأولوية", "اولوية")
    reason = _field("reason", "السبب", "سبب")
    action = _field("action", "الإجراء المقترح", "الإجراء", "الاجراء", "إجراء", "اجراء")
    if not (typ or action or reason):
        return None
    out: dict = {}
    if typ:    out["type"]            = typ
    if ptype:  out["problem_type"]    = ptype
    if stype:  out["suggestion_type"] = stype
    if prio:   out["priority"]        = prio
    if reason: out["reason"]          = reason
    if action: out["action"]          = action
    return out


# Singleton
llm_service_instance = LLMService()
