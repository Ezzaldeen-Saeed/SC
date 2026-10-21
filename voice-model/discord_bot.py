"""
Discord Call Monitor Bot — Real-Time
────────────────────────────────────
• ينضم لقناة صوتية تلقائياً بمجرد دخول أول شخص (أو يدوياً عبر !join)
• يفرّغ الصوت لحظياً عبر Whisper المحلي (faster-whisper) ويبثّه للـ Dashboard فوراً
• يحلل كل جملة عبر الـ LLM ويعرض التوجيهات اللحظية
• عند انتهاء المكالمة يولّد تقريراً نهائياً ويرسله للـ Dashboard

يعمل بطريقتين:
  1) داخل سيرفر FastAPI (app.py) — يبثّ مباشرةً عبر broadcaster (الأفضل).
  2) مستقلاً (python discord_bot.py) — يرسل عبر HTTP POST لـ /api/bot_update.
"""

import asyncio
import io
import logging
import os
import re
import threading
import time
import wave

import aiohttp
import discord
import numpy as np
import discord.ext.voice_recv as voice_recv

import config
import whisper_service
from llm_service import llm_service_instance as llm_svc

logger = logging.getLogger("discord_bot")


# ── تحميل Opus (هام على ويندوز — discord.py لا يحمّلها تلقائياً) ──────────────
def load_opus_lib() -> None:
    if discord.opus.is_loaded():
        return
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "libopus.dll"),   # المرفق مع المشروع (ويندوز)
        "libopus",                            # موجودة على PATH / النظام
        "opus",
    ]
    for cand in candidates:
        try:
            discord.opus.load_opus(cand)
            if discord.opus.is_loaded():
                logger.info("✅ Opus loaded from %s", cand)
                return
        except Exception:
            continue
    logger.warning("⚠️ تعذّر تحميل Opus — قد يفشل استقبال الصوت من Discord.")


load_opus_lib()


# ملاحظة حول DAVE/E2EE: منذ 2024 يُشفّر Discord المكالمات طرفياً (DAVE). لا يمكن
# تعطيله بإعلان الإصدار 0 (السيرفر يرفض الاتصال بـ close 4017 — حماية ضد التنزيل).
# لذا نترك DAVE يتفاوض طبيعياً، ثم نفكّ التشفير في مسار الاستقبال عبر جلسة DAVE
# التي ينشئها discord.py (انظر _install_dave_decrypt أدناه).


# ── صلابة استقبال الصوت ──────────────────────────────────────────────────────
# مكتبة voice_recv توقف الاستماع بالكامل عند أول خطأ فكّ ترميز لحزمة واحدة
# (OpusError: corrupted stream — راجع router.py: stop_listening في finally).
# نجعل المعالجة على مستوى الحزمة الواحدة: نتخطّى الحزمة التالفة ونُكمل الجلسة.
_corrupt_count = 0

def _install_voice_resilience() -> None:
    import discord.opus as _dopus
    from discord.ext.voice_recv import opus as _vopus

    # 1) أعِد إطار صمت بدل رفع OpusError عند فشل فكّ الترميز
    if not getattr(_dopus.Decoder, "_resilient_patch", False):
        _orig_decode = _dopus.Decoder.decode

        def _safe_decode(self, data, *, fec=False):
            global _corrupt_count
            try:
                return _orig_decode(self, data, fec=fec)
            except _dopus.OpusError as e:
                _corrupt_count += 1
                # سجّل أول واحدة ثم كل 50 لمعرفة الحجم (هل هي نادرة أم كثيرة؟)
                if _corrupt_count == 1 or _corrupt_count % 50 == 0:
                    logger.warning("حزم صوت تالفة حتى الآن: %d (تُتخطّى) — %s", _corrupt_count, e)
                # إطار صمت 20ms (يحافظ على التزامن دون إسقاط الجلسة)
                return b"\x00" * (self.SAMPLES_PER_FRAME * self.CHANNELS * 2)

        _dopus.Decoder.decode = _safe_decode
        _dopus.Decoder._resilient_patch = True

    # 2) شبكة أمان: أي خطأ آخر أثناء معالجة حزمة → تخطّاها بدل تعطيل الحلقة
    if not getattr(_vopus.PacketDecoder, "_resilient_patch", False):
        _orig_pop = _vopus.PacketDecoder.pop_data

        def _safe_pop(self, *a, **k):
            try:
                return _orig_pop(self, *a, **k)
            except Exception as e:
                logger.debug("تخطّي حزمة أثناء pop_data: %s", e)
                return None

        _vopus.PacketDecoder.pop_data = _safe_pop
        _vopus.PacketDecoder._resilient_patch = True

    logger.info("🛡️ تم تفعيل صلابة استقبال الصوت (تخطّي الحزم التالفة).")


_install_voice_resilience()


# ── فكّ تشفير DAVE/E2EE للصوت المستقبَل ───────────────────────────────────────
# Discord يفعّل تشفيراً طرفياً (DAVE) للمكالمات، و voice_recv يفكّ طبقة النقل
# فقط ويترك طبقة E2EE → يصل للـ opus صوت مُشفّر ("corrupted stream"). discord.py
# يُنشئ جلسة DAVE كاملة (عبر بروتوكول MLS)، فنستخدمها لفكّ كل حزمة بعد فكّ النقل.
def _install_dave_decrypt() -> None:
    try:
        import davey
        from discord.ext.voice_recv import opus as _vopus
    except Exception as e:
        logger.warning("تعذّر تجهيز فكّ DAVE: %s", e)
        return

    if getattr(_vopus.PacketDecoder, "_dave_patch", False):
        return

    _orig_push = _vopus.PacketDecoder.push_packet
    _AUDIO = davey.MediaType.audio

    def _push_with_dave(self, packet):
        # بعد فكّ طبقة النقل (decrypted_data)، طبّق فكّ DAVE إن كانت الجلسة جاهزة
        try:
            data = getattr(packet, "decrypted_data", None)
            if data:
                vc = self.sink.voice_client
                sess = getattr(getattr(vc, "_connection", None), "dave_session", None)
                if sess is not None and sess.ready:
                    uid = vc._ssrc_to_id.get(self.ssrc)
                    # can_passthrough = هذا المستخدم يرسل صوتاً غير مشفّر طرفياً
                    if uid and not sess.can_passthrough(int(uid)):
                        packet.decrypted_data = sess.decrypt(int(uid), _AUDIO, bytes(data))
        except Exception as e:
            logger.debug("تخطّي فكّ DAVE (ssrc=%s): %s", getattr(self, "ssrc", "?"), e)
        return _orig_push(self, packet)

    _vopus.PacketDecoder.push_packet = _push_with_dave
    _vopus.PacketDecoder._dave_patch = True
    logger.info("🔐 تم تفعيل فكّ تشفير DAVE/E2EE للصوت المستقبَل.")


_install_dave_decrypt()

# ── ثوابت الصوت ──────────────────────────────────────────────────────────────
SAMPLE_RATE   = 48_000
CHANNELS      = 2
BYTES_PER_SEC = SAMPLE_RATE * CHANNELS * 2          # 192,000 بايت/ثانية (ستيريو 16-bit)

MAX_CHUNK_BYTES   = int(BYTES_PER_SEC * 4.0)        # تفريغ قسري بعد 4 ثوانٍ كلام متصل
MIN_CHUNK_BYTES   = int(BYTES_PER_SEC * 0.8)        # أقل مدة للتفريغ عند الصمت (0.8 ث)
FINAL_MIN_BYTES   = int(BYTES_PER_SEC * 0.6)        # أقل مدة تُحفظ عند إنهاء المكالمة
SILENCE_FLUSH_SEC = 0.7                             # اعتبر صمتاً بعد توقّف الصوت بهذه المدة
# تجميع الأدوار: يُحلَّل كلام المتحدث عند تغيّر المتحدث، أو بعد صمته بهذه المدة.
# أقصر = توجيه أسرع وأكتر بمجرد ما يخلّص كلامه. 1.2ث توازن جيد بين السرعة وعدم تقطيع
# الدور الواحد لنُصّين. قابل للضبط من .env (TURN_GAP_SEC).
TURN_GAP_SEC      = float(os.getenv("TURN_GAP_SEC", "1.2"))

# تهدئة التوجيهات: أقل فاصل زمني (ث) بين توجيهين عاديين (نصيحة/متوسط) حتى يبقوا «أقل
# وأهم» — التحذيرات والأولوية العالية بتعدّي فوراً (استثناء). قابل للضبط من .env.
COACH_COOLDOWN_SEC = float(os.getenv("COACH_COOLDOWN_SEC", "15"))

# ── التوكن ───────────────────────────────────────────────────────────────────
# يُقرأ من voice-model/.env (DISCORD_TOKEN) — لا تكتبه صريحاً في الكود.
# لو كان فاضياً، السيرفر يعمل لكن البوت يتوقّف (انظر app.py).
TOKEN = config.DISCORD_TOKEN

DASHBOARD_URL = f"http://127.0.0.1:{config.PORT}/api/bot_update"


# نبقي الصوت بمعدّل Discord الأصلي (48kHz) خام؛ whisper_service يعيد أخذ العيّنات إلى
# 16kHz داخلياً بمرشّح مضادّ للتشويه قبل التفريغ — فمفيش downsampling هنا.
SR_OUT = SAMPLE_RATE   # 48_000

# عتبة RMS (مُطبَّعة 0..1) نعتبر تحتها المقطع صامتاً فلا نفرّغه (نتفادى هلوسة على الصمت).
SILENCE_RMS = 0.005


# ── تحويل PCM (48k/stereo) → عيّنات 48k/mono ثم WAV يقرأه Whisper ─────────────
# نبعت الصوت خام (بس دمج القناتين للمونو) بلا أي معالجة (تطبيع/كسب/قصّ ضوضاء) — الموديل
# بيتعامل مع جودة الصوت داخلياً، وأي معالجة يدوية بتدخّل تشويهات وتضخّم الضوضاء فتقلّل الدقّة.
def pcm48_to_mono(pcm: bytes) -> np.ndarray:
    """48kHz ستيريو 16-bit → 48kHz مونو int16 — دمج القناتين فقط (بلا downsampling/معالجة)."""
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    if CHANNELS == 2 and samples.size:
        samples = samples[: (samples.size // 2) * 2]         # عدد زوجي للستيريو
        samples = samples.reshape(-1, 2).mean(axis=1)        # ستيريو → مونو (بدون تغيير المعدّل)
    return np.clip(np.round(samples), -32768, 32767).astype(np.int16)


def wav_from_mono(samples: np.ndarray, sr: int = SR_OUT) -> bytes:
    """يبني WAV (linear16 مونو) بالمعدّل الأصلي — يقرأه whisper_service ويعيد أخذ عيّناته."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(np.asarray(samples, dtype=np.int16).tobytes())
    return buf.getvalue()


def rms_level(samples: np.ndarray) -> float:
    """جذر متوسّط مربّع السعة (مُطبَّع 0..1) — للكشف عن المقاطع الصامتة قبل الإرسال."""
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean((samples.astype(np.float32) / 32768.0) ** 2)))


# ── تشخيص: حفظ المقاطع الصوتية لفحصها ────────────────────────────────────────
_DUMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_debug_audio")

def _dump_wav(wav_bytes: bytes, name: str) -> None:
    try:
        os.makedirs(_DUMP_DIR, exist_ok=True)
        safe = "".join(c for c in name if c.isalnum() or c in "-_") or "user"
        fname = f"{time.strftime('%H%M%S')}_{int(time.time()*1000)%1000:03d}_{safe}.wav"
        with open(os.path.join(_DUMP_DIR, fname), "wb") as f:
            f.write(wav_bytes)
    except Exception as e:
        logger.debug("تعذّر حفظ مقطع التشخيص: %s", e)


# ── تسمية المتحدثين بأدوارهم (الموظف/العميل) بدل أرقام diarization ─────────────
# diarization بيرجّع "متحدث ١/٢" (أرقام مالهاش معنى للمستخدم ولا للموديل). هنا نحلّل
# كلام كل متحدث ونحدّد مين الموظف (بيرحّب، بيمثّل الشركة، بيعرض حل) ومين العميل
# (صاحب الشكوى) — فيبقى النص احترافي على اللوحة وأوضح للموديل في التحليل.
_AGENT_MARKERS = (
    "خدمة عملاء", "خدمه العملاء", "خدمة العملاء", "معاك", "معاكي", "اتفضل", "اتفضلي",
    "حضرتك", "فندم", "في خدمتك", "تحت أمرك", "أقدر أساعد", "اساعدك", "أساعدك",
    "ممكن رقم", "رقم الخط", "رقم الشكوى", "هيتم حل", "هتابع", "بلاغ", "تذكرة",
    "رقم مرجعي", "فودافون", "اتصالات", "أورنج", "المصرية للاتصالات", "شكراً لتواصلك",
    "يوم سعيد", "ممكن أعرف", "لو سمحت اديني", "هراجع", "هفحص", "هعمل", "دقيقة من وقتك",
    "أهلاً بحضرتك", "أي خدمة تانية", "تمام كده",
)
_CUSTOMER_MARKERS = (
    "عندي مشكلة", "النت", "الراوتر", "مقطوع", "مش شغال", "مش شغالة", "فاصل",
    "عايز", "عاوز", "مش راضي", "زهقت", "تعبت", "شكوى", "ألغي", "الغي", "التعاقد",
    "مفيش حل", "محدش بيرد", "بقالي", "مستني", "مش معقول", "كفاية", "الفاتورة غالية",
    "النت بيفصل", "بقاله يومين", "حرام عليكو", "عايز أكلم مسؤول", "مش عارف",
)

# ── مؤشرات «مجرى المكالمة» (تُبنى منها خلاصة الحالة المُمرَّرة للتحليل اللحظي) ────
# الهدف: التوجيه يتبني على *السياق التراكمي* للمكالمة، مش على كلمة واحدة في آخر دور.
# كل قائمة إشارة خفيفة (وجودها = مؤشر) — تُحسب بلا أي نداء LLM إضافي.
_ANGER_MARKERS = (
    "زهقت", "تعبت", "مش طايق", "كفاية", "محدش بيرد", "مفيش حل", "هلغي", "ألغي",
    "الغي", "التعاقد", "هسيب", "مسؤول", "مشرف", "حرام عليكو", "من امبارح",
    "مش معقول", "زعلان", "غضب", "بقالي", "تلغي", "هشتكي", "النيابة",
)
_TICKET_MARKERS  = ("بلاغ", "تذكرة", "رقم مرجعي", "رقم الشكوى", "رقم الطلب", "فتحتلك")
_PROMISE_MARKERS = ("٢٤ ساعة", "24 ساعة", "خلال ٢٤", "خلال 24", "بكرة", "خلال يوم",
                    "النهارده", "خلال ساعة", "هيتم الحل", "هيتحل")
_IDCHECK_MARKERS = ("الرقم القومي", "البطاقة", "كود التحقق", "رقم الخط", "رقم الحساب",
                    "اتأكد من", "تأكيد الهوية", "الموبايل المسجل", "بيانات الخط")


def _iso(epoch: float) -> str:
    """زمن Unix → ISO-8601 بتوقيت UTC (Z) — صيغة موحّدة يفهمها الـ backend والـ frontend."""
    from datetime import datetime, timezone
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _assign_roles(turns: "list[tuple[str, str]]") -> "list[tuple[str, str]]":
    """يحوّل أدوار diarization إلى أدوار حقيقية: يعيد قائمة (role, text) حيث role
    «الموظف» أو «العميل». الموظف = الأعلى استخداماً لألفاظ خدمة العملاء، والتعادل
    يُحسم لأول من تكلّم (هو اللي بيرحّب). لو متحدث واحد بس، يرجّع النص بلا تسمية."""
    if not turns:
        return turns
    by_spk: dict[str, list[str]] = {}
    order: list[str] = []
    for spk, text in turns:
        if spk not in by_spk:
            by_spk[spk] = []
            order.append(spk)
        by_spk[spk].append(text)
    if len(by_spk) < 2:                          # متحدث واحد: تعذّر الفصل بالصوت
        return [("", t) for _, t in turns]
    # نعدّ *تنوّع* العبارات المميّزة (وجود العبارة مرة = إشارة)، لا تكرارها — عبارة
    # واحدة متكرّرة كتير أضعف دلالةً من تنوّع عبارات خدمة العملاء. أدقّ في تحديد الدور.
    score: dict[str, int] = {}
    for spk, parts in by_spk.items():
        blob = " ".join(parts)
        a = sum(1 for m in _AGENT_MARKERS if m in blob)
        c = sum(1 for m in _CUSTOMER_MARKERS if m in blob)
        score[spk] = a - c
    # الأعلى نزعةً للموظف؛ عند التعادل الأسبق في الكلام (index أصغر) = الموظف
    # (في الكول سنتر الموظف عادةً بيرحّب ويفتح المكالمة).
    agent_spk = max(order, key=lambda s: (score[s], -order.index(s)))
    return [("الموظف" if spk == agent_spk else "العميل", text) for spk, text in turns]


def _name_at(ranges: "list[tuple[float, float, str]]", t: float) -> str:
    """يعيد اسم المتحدّث المعروف عند الزمن t (بالثواني) من خريطة المزج الزمنية.
    ranges = [(start_sec, end_sec, name)] مبنية من إزاحات العيّنات في نفس الملف
    المُرسَل لـ Whisper — فالمطابقة دقيقة. عند وقوع t خارج الحدود (تقريب) نلتقط أقرب مقطع."""
    if not ranges:
        return ""
    for a, b, name in ranges:
        if a <= t < b:
            return name
    if t < ranges[0][0]:
        return ranges[0][2]
    return ranges[-1][2]


def _merge_same_speaker(turns: "list[tuple[str, str]]") -> "list[tuple[str, str]]":
    """يدمج الأدوار المتتالية لنفس المتحدّث في دور واحد (عرض أنظف واتساق مع الحيّ)."""
    merged: list[tuple[str, str]] = []
    for name, text in turns:
        text = (text or "").strip()
        if not text:
            continue
        if merged and merged[-1][0] == name:
            merged[-1] = (name, f"{merged[-1][1]} {text}".strip())
        else:
            merged.append((name, text))
    return merged


# ── البوت ────────────────────────────────────────────────────────────────────
class CallMonitorBot(discord.Client):
    def __init__(self, broadcaster=None):
        intents = discord.Intents.default()      # voice_states + guilds (غير مُمتازة)
        intents.message_content = True           # مطلوبة لأوامر !join/!leave (فعّلها بالبورتال)
        super().__init__(intents=intents)

        self._broadcaster = broadcaster          # async fn(dict) للبثّ المباشر، أو None → HTTP
        self.http_session: aiohttp.ClientSession | None = None

        # مخازن الصوت (يُكتب عليها من خيط استقبال الصوت → نحميها بقفل)
        self._buf_lock     = threading.Lock()
        self.user_buffers  : dict[int, bytearray] = {}
        self.user_names    : dict[int, str]       = {}
        self.last_audio    : dict[int, float]     = {}

        self.call_transcript: list[str] = []
        # (المتحدث, زمن‑البدء‑المونوتوني, عيّنات48k) — الزمن يضمن ترتيباً زمنياً صحيحاً
        # للتسجيل الكامل مهما اختلف ترتيب المعالجة، وبه نربط جُمل Whisper بالمتحدّث المعروف.
        self.call_audio: list[tuple[str, float, np.ndarray]] = []
        self.monitoring = False
        # توقيت المكالمة الفعلي (زمن الحائط) — مصدر الحقيقة لمدة المكالمة في التقرير،
        # مستقل عن وقت توليد التقرير حتى ما تتضخّمش المدة المحفوظة.
        self.call_started_at: float | None = None
        self.call_ended_at: float | None = None

        # تجميع الأدوار — نعرض كلام المتحدث كاملاً عند انتهاء دوره (مش مُجزّأ)
        self.turn_speaker: str | None = None
        self.turn_parts: list[str] = []
        self.turn_last: float = 0.0

        # حالة «مجرى المكالمة» التراكمية — تُبنى منها خلاصة تُمرَّر لكل تحليل لحظي حتى
        # يكون التوجيه مبنياً على المكالمة كلها لا على كلمة واحدة. + إزالة تكرار التوجيه.
        self.flow: dict = self._new_flow()
        self._last_sug_sig: str = ""
        self._last_sug_ts: float = 0.0        # وقت آخر توجيه ظهر (لتهدئة التكرار)

        self.audio_queue    : asyncio.Queue | None = None   # (name, pcm) للتفريغ
        self.analysis_queue : asyncio.Queue | None = None   # (text, ctx) للتحليل
        self._workers: list[asyncio.Task] = []

    # ── الإعداد عند بدء التشغيل ───────────────────────────────────────────────
    async def setup_hook(self):
        self.http_session   = aiohttp.ClientSession()
        self.audio_queue    = asyncio.Queue()
        self.analysis_queue = asyncio.Queue(maxsize=3)      # محدودة لإبقاء التحليل لحظياً
        self._workers = [
            asyncio.create_task(self._monitor_buffers()),
            asyncio.create_task(self._transcribe_worker()),
            asyncio.create_task(self._analysis_worker()),
        ]
        logger.info("🤖 إعداد البوت اكتمل — العمال يعملون.")

    async def close(self):
        for t in self._workers:
            t.cancel()
        if self.http_session and not self.http_session.closed:
            await self.http_session.close()
        await super().close()

    # ── البثّ للـ Dashboard (مباشر أو HTTP) ──────────────────────────────────
    async def push(self, payload: dict):
        if self._broadcaster is not None:
            try:
                await self._broadcaster(payload)
                return
            except Exception as e:
                logger.warning("البثّ المباشر فشل: %s", e)
        try:
            async with self.http_session.post(
                DASHBOARD_URL, json=payload,
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                await resp.read()
        except Exception as e:
            logger.warning("POST للـ Dashboard فشل (%s): %s", DASHBOARD_URL, e)

    # ── استقبال الصوت — يُستدعى من خيط voice_recv (متزامن!) ───────────────────
    def _on_voice(self, user, data):
        if user is None or not data.pcm:
            return
        uid = user.id
        with self._buf_lock:
            buf = self.user_buffers.get(uid)
            if buf is None:
                buf = self.user_buffers[uid] = bytearray()
            buf.extend(data.pcm)
            self.user_names[uid] = getattr(user, "display_name", None) or str(uid)
            self.last_audio[uid] = time.monotonic()

    # ── مراقبة المخازن وتقطيعها لأجزاء عند الصمت أو بلوغ الحد ──────────────────
    async def _monitor_buffers(self):
        try:
            while True:
                await asyncio.sleep(0.3)
                now = time.monotonic()
                ready: list[tuple[str, bytes, float]] = []
                with self._buf_lock:
                    for uid, buf in self.user_buffers.items():
                        n = len(buf)
                        if n == 0:
                            continue
                        idle = now - self.last_audio.get(uid, now)
                        if n >= MAX_CHUNK_BYTES or (n >= MIN_CHUNK_BYTES and idle >= SILENCE_FLUSH_SEC):
                            # زمن بدء المقطع ≈ الآن − مدّته → ترتيب زمني صحيح عبر المتحدّثين
                            t_start = now - (n / BYTES_PER_SEC)
                            ready.append((self.user_names.get(uid, str(uid)), bytes(buf), t_start))
                            buf.clear()
                for name, pcm, t_start in ready:
                    await self.audio_queue.put((name, pcm, t_start))

                # اعرض دور المتحدث لو صمت طويلاً (نهاية دور بدون تغيّر متحدث)
                if self.turn_parts and (now - self.turn_last) >= TURN_GAP_SEC:
                    await self._flush_turn()
        except asyncio.CancelledError:
            pass

    # ── عامل التفريغ: صوت → نص → بثّ فوري → جدولة التحليل ─────────────────────
    async def _transcribe_worker(self):
        try:
            while True:
                name, pcm, t_start = await self.audio_queue.get()
                try:
                    samples = pcm48_to_mono(pcm)                 # 48kHz مونو خام (بلا معالجة)
                    if config.DEBUG_DUMP_AUDIO:
                        _dump_wav(wav_from_mono(samples), name)  # احفظ الخام للتشخيص

                    # خزّن الخام (مع زمن بدئه) لإعادة تفريغه بدقة في التقرير — حتى لو فشل
                    # النموذج الحيّ لا يضيع نص المكالمة. نتخطّى المقاطع الصامتة فقط.
                    rms = rms_level(samples)
                    if rms >= SILENCE_RMS:
                        self.call_audio.append((name, t_start, samples))

                    # تفريغ حيّ عبر Whisper المحلي: نبعت الصوت *خام* 48kHz (whisper_service
                    # يعيد أخذ عيّناته إلى 16kHz داخلياً). نتخطّى الصمت فقط حتى لا نهلوس على
                    # مقطع فاضي ولا نضيّع حساباً على الـ GPU بلا داعٍ.
                    text = ""
                    if rms >= SILENCE_RMS:
                        text = await whisper_service.transcribe_wav(wav_from_mono(samples))
                    if text:
                        self.call_transcript.append(f"[{name}]: {text}")
                        logger.info("[%s]: %s", name, text)
                        # تجميع الأدوار: يُعرض الدور كاملاً عند انتهائه (مش مُجزّأ)
                        await self._append_turn(name, text)
                except Exception as e:
                    logger.error("خطأ في عامل التفريغ: %s", e, exc_info=True)
                finally:
                    self.audio_queue.task_done()
        except asyncio.CancelledError:
            pass

    # ── تجميع الأدوار: عرض كلام المتحدث كاملاً عند انتهاء دوره ─────────────────
    async def _append_turn(self, name: str, text: str):
        # تغيّر المتحدث → اعرض الدور السابق كاملاً أولاً
        if self.turn_speaker is not None and name != self.turn_speaker:
            await self._flush_turn()
        self.turn_speaker = name
        self.turn_parts.append(text)
        self.turn_last = time.monotonic()

    async def _flush_turn(self):
        """يعرض دور المتحدث الحالي كاملاً (سطر واحد) ويرسله للتحليل بسياق كامل +
        خلاصة حالة المكالمة التراكمية حتى يكون التوجيه مبنياً على المجرى كله."""
        if not self.turn_parts:
            return
        speaker = self.turn_speaker or ""
        full = " ".join(p.strip() for p in self.turn_parts if p.strip()).strip()
        self.turn_parts = []
        self.turn_speaker = None
        if not full:
            return
        await self.push({"type": "realtime_transcript", "transcript": f"[{speaker}]: {full}"})
        self._update_flow(full)                       # حدّث حالة المكالمة التراكمية
        ctx = "\n".join(self.call_transcript[-20:])
        brief = self._build_brief()
        try:
            self.analysis_queue.put_nowait((speaker, full, ctx, brief))
        except asyncio.QueueFull:
            pass

    # ── حالة «مجرى المكالمة» التراكمية ────────────────────────────────────────
    @staticmethod
    def _new_flow() -> dict:
        return {"turns": 0, "issue": "", "anger": 0,
                "ticket": False, "promise": False, "id_check": False}

    def _update_flow(self, text: str) -> None:
        """يحدّث مؤشرات المكالمة من نص الدور (بلا أي نداء LLM) — أساس الخلاصة السياقية."""
        f = self.flow
        f["turns"] += 1
        f["anger"] += sum(1 for m in _ANGER_MARKERS if m in text)
        if not f["ticket"] and any(m in text for m in _TICKET_MARKERS):
            f["ticket"] = True
        if not f["promise"] and any(m in text for m in _PROMISE_MARKERS):
            f["promise"] = True
        if not f["id_check"] and any(m in text for m in _IDCHECK_MARKERS):
            f["id_check"] = True
        # أول دور فيه مؤشر مشكلة = مشكلة العميل الأساسية (يثبت طوال المكالمة كمرجع سياقي)
        if not f["issue"] and any(m in text for m in _CUSTOMER_MARKERS):
            f["issue"] = text[:140]

    def _build_brief(self) -> str:
        """يبني خلاصة عربية مختصرة لحالة المكالمة تُمرَّر للتحليل اللحظي (السياق الكلّي)."""
        f = self.flow
        if f["turns"] <= 1 and not f["issue"]:
            return ""
        lines = [f"- عدد الأدوار حتى الآن: {f['turns']}"]
        if f["issue"]:
            lines.append(f"- مشكلة العميل الأساسية: {f['issue']}")
        signals = []
        if f["anger"] >= 2:
            signals.append(f"غضب/إحباط متكرر (×{f['anger']})")
        elif f["anger"] == 1:
            signals.append("بادرة انزعاج")
        if f["id_check"]:
            signals.append("تم التحقق من الهوية")
        if f["ticket"]:
            signals.append("تم فتح بلاغ/تذكرة")
        if f["promise"]:
            signals.append("اتقال وعد بحل (تأكّد من التنفيذ لا مجرد الوعد)")
        if signals:
            lines.append("- مؤشرات: " + " · ".join(signals))
        return "ملخص حالة المكالمة حتى الآن:\n" + "\n".join(lines)

    # ── عامل التحليل اللحظي (منفصل حتى لا يؤخّر النص) ─────────────────────────
    async def _analysis_worker(self):
        try:
            while True:
                speaker, turn, ctx, brief = await self.analysis_queue.get()
                try:
                    result = await llm_svc.analyze_realtime_chunk(
                        turn, ctx, speaker=speaker, call_brief=brief)
                    if result and not self._is_duplicate_suggestion(result) \
                            and self._should_emit_now(result):
                        await self.push({"type": "realtime_analysis", "analysis": result})
                except Exception as e:
                    logger.error("خطأ في عامل التحليل: %s", e)
                finally:
                    self.analysis_queue.task_done()
        except asyncio.CancelledError:
            pass

    def _is_duplicate_suggestion(self, result: str) -> bool:
        """يمنع تكرار *نفس* التوجيه في أدوار متتالية (إحساس احترافي غير مُلِح) — يقارن
        توقيع الإجراء بآخر توجيه ظهر. يعيد True لو مكرّر فيُتخطّى."""
        try:
            import json as _json
            action = str((_json.loads(result) or {}).get("action", "")).strip()
        except Exception:
            action = result.strip()
        if not action:
            return False
        sig = re.sub(r"\s+", " ", action).strip()[:60]
        if sig and sig == self._last_sug_sig:
            return True
        self._last_sug_sig = sig
        return False

    def _should_emit_now(self, result: str) -> bool:
        """تهدئة: التوجيهات العادية (نصيحة/متوسط/منخفض) بيحصلها فاصل زمني حتى تبقى «أقل
        وأهم». التحذيرات والأولوية العالية بتعدّي فوراً (مواقف حرجة). يحدّث زمن آخر توجيه."""
        try:
            import json as _json
            data = _json.loads(result) or {}
        except Exception:
            data = {}
        typ  = str(data.get("type", "")).strip()
        prio = str(data.get("priority", "")).strip().lower()
        urgent = (typ == "تحذير") or (prio == "high")
        now = time.monotonic()
        if not urgent and (now - self._last_sug_ts) < COACH_COOLDOWN_SEC:
            return False                      # لسه بدري على توجيه عادي جديد
        self._last_sug_ts = now
        return True

    # ── بدء المراقبة (الانضمام + الاستماع) ───────────────────────────────────
    async def _start_monitoring(self, channel: "discord.VoiceChannel"):
        if channel.guild.voice_client is not None:
            return  # متصل بالفعل في هذا السيرفر
        try:
            vc = await channel.connect(cls=voice_recv.VoiceRecvClient)
        except Exception as e:
            logger.error("فشل الانضمام للقناة %s: %s", channel, e)
            await self.push({"type": "system_log",
                             "message": f"تعذّر الانضمام للقناة الصوتية: {e}", "level": "ERROR"})
            return

        vc.listen(voice_recv.BasicSink(self._on_voice))

        with self._buf_lock:
            self.user_buffers.clear()
            self.user_names.clear()
            self.last_audio.clear()
        self.call_transcript.clear()
        self.call_audio.clear()
        self.turn_speaker = None
        self.turn_parts = []
        self.flow = self._new_flow()
        self._last_sug_sig = ""
        self._last_sug_ts = 0.0
        self.monitoring = True
        self.call_started_at = time.time()       # بداية المكالمة (زمن الحائط)
        self.call_ended_at = None

        await self.push({"type": "clear"})
        await self.push({"type": "system_log",
                         "message": f"🎙️ بدأت مراقبة المكالمة على قناة «{channel.name}» — التفريغ والتحليل اللحظي جاهزين.",
                         "level": "INFO"})
        logger.info("بدأت المراقبة في القناة: %s", channel.name)

    # ── إيقاف المراقبة (فصل + تقرير نهائي) ───────────────────────────────────
    async def _stop_monitoring(self, guild: "discord.Guild"):
        vc = guild.voice_client
        if vc is None:
            return
        self.monitoring = False
        self.call_ended_at = time.time()         # نهاية المكالمة الفعلية (قبل توليد التقرير)
        try:
            if isinstance(vc, voice_recv.VoiceRecvClient) and vc.is_listening():
                vc.stop_listening()
        except Exception:
            pass

        # فرّغ ما تبقّى في المخازن لتضمينه في التقرير (مع زمن بدء تقريبي للترتيب الزمني)
        now = time.monotonic()
        leftovers: list[tuple[str, bytes, float]] = []
        with self._buf_lock:
            for uid, buf in self.user_buffers.items():
                if len(buf) >= FINAL_MIN_BYTES:
                    t_start = now - (len(buf) / BYTES_PER_SEC)
                    leftovers.append((self.user_names.get(uid, str(uid)), bytes(buf), t_start))
                buf.clear()
        for name, pcm, t_start in leftovers:
            await self.audio_queue.put((name, pcm, t_start))

        try:
            await vc.disconnect()
        except Exception:
            pass

        await self.push({"type": "system_log",
                         "message": "📞 انتهت المكالمة — جاري إعداد التقرير النهائي...", "level": "INFO"})

        # انتظر تفريغ ما تبقّى (بمهلة قصوى حتى لا نعلّق)
        try:
            await asyncio.wait_for(self.audio_queue.join(), timeout=25)
        except asyncio.TimeoutError:
            logger.warning("انتهت مهلة انتظار التفريغ النهائي.")

        # اعرض آخر دور لم يُعرض بعد (نهاية المكالمة)
        await self._flush_turn()

        # احفظ صوت المكالمة الكامل دايماً للمراجعة + ابثّ إحصاءات الوضوح للوحة
        await self._save_and_report_audio()

        # إعادة تفريغ المكالمة كاملةً بإرسال *الملف المحفوظ* لـ Whisper في نداء واحد (أدقّ
        # لأن الموديل يرى السياق الكامل)، ثم نسب كل جملة للمتحدّث *المعروف* (من قنوات
        # Discord) بالمطابقة الزمنية. عند الفشل نتراجع للنص الحيّ المتراكم.
        diarized = await self._report_transcript()
        transcript = diarized or "\n".join(self.call_transcript)

        if transcript.strip():
            # ملاحظة: تصحيح أخطاء التفريغ (ASR) بقى جوّه _report_transcript مع الحفاظ على
            # فصل المتحدّثين (correct_labeled_turns) — فالنص هنا مصحّح ومفصول بالفعل.
            report = await llm_svc.generate_post_call_report(transcript)
            # أرفق توقيت المكالمة الفعلي (زمن الحائط) حتى تُحفظ المدة صح ومستقلة عن
            # الوقت اللي استغرقه توليد التقرير على الموديل المحلي.
            evt = {"type": "post_call_report", "report": report}
            if self.call_started_at:
                evt["call_start"] = _iso(self.call_started_at)
                evt["call_end"] = _iso(self.call_ended_at or time.time())
                evt["duration_seconds"] = int((self.call_ended_at or time.time()) - self.call_started_at)
            await self.push(evt)
        else:
            await self.push({"type": "system_log",
                             "message": "لا يوجد نص كافٍ لإنشاء تقرير.", "level": "WARNING"})

        logger.info("تم إنهاء المراقبة وإرسال التقرير.")

    def _sorted_call_audio(self) -> "list[tuple[str, float, np.ndarray]]":
        """مقاطع المكالمة مرتّبة زمنياً بزمن بدئها — أساس تسجيل كامل أمين وترتيب صحيح."""
        return sorted(self.call_audio, key=lambda x: x[1])

    def _full_call_samples(self) -> np.ndarray:
        """يدمج كل عيّنات المكالمة (48k mono) في مصفوفة واحدة بالترتيب الزمني الصحيح."""
        audio = self._sorted_call_audio()
        return np.concatenate([s for _, _, s in audio]) if audio else np.zeros(0, np.int16)

    def _speaker_timeline(self) -> "list[tuple[float, float, str]]":
        """خريطة (بداية_ث, نهاية_ث, اسم) لكل مقطع داخل المزج الكامل — محسوبة من إزاحات
        العيّنات في نفس الملف المُرسَل لـ Whisper، فبها نربط جُمل التفريغ بالمتحدّث
        *المعروف* من قنوات Discord المنفصلة (نسب مضمون بلا تخمين)."""
        ranges: list[tuple[float, float, str]] = []
        offset = 0
        for name, _t, s in self._sorted_call_audio():
            n = int(getattr(s, "size", 0))
            if n <= 0:
                continue
            ranges.append((offset / SR_OUT, (offset + n) / SR_OUT, name))
            offset += n
        return ranges

    async def _save_and_report_audio(self) -> None:
        """يحفظ كامل صوت المكالمة في _debug_audio/full_call.wav (للمراجعة) ويبثّ
        إحصاءات الوضوح (المدة/RMS/الذروة/التشبّع) للوحة عشان تتأكد إن الصوت وصل
        نظيف ومسموع للموديل. يُستدعى مرّة واحدة عند إنهاء المكالمة في كل المسارات."""
        try:
            os.makedirs(_DUMP_DIR, exist_ok=True)
            alls = self._full_call_samples()
            path = os.path.join(_DUMP_DIR, "full_call.wav")
            with open(path, "wb") as f:
                f.write(wav_from_mono(alls))
            dur = alls.size / SR_OUT
            if alls.size:
                norm = alls.astype(np.float32) / 32768.0
                rms  = float(np.sqrt(np.mean(norm ** 2)))
                peak = float(np.max(np.abs(norm)))
                clip = float(np.mean(np.abs(alls) >= 32700)) * 100
            else:
                rms = peak = clip = 0.0
            logger.info("💾 full_call.wav: %.1fث  rms=%.4f  peak=%.3f  clip=%.2f%%  → %s",
                        dur, rms, peak, clip, path)
            # تقييم بسيط لوضوح الصوت يُعرض للمستخدم في سجلّ اللوحة
            if dur < 0.5:
                verdict = "⚠️ صوت قصير جداً"
            elif rms < 0.01:
                verdict = "⚠️ صوت خافت جداً (قد يضعف التفريغ)"
            elif clip > 1.0:
                verdict = "⚠️ تشبّع/تقطيع في الصوت (عالي زيادة)"
            else:
                verdict = "✅ جودة الصوت جيدة"
            await self.push({
                "type": "system_log", "level": "INFO",
                "message": (f"💾 اتحفظ صوت المكالمة (full_call.wav) — {dur:.0f}ث · "
                            f"RMS {rms:.3f} · ذروة {peak:.2f} · تشبّع {clip:.1f}% — {verdict}"),
            })
        except Exception as e:
            logger.warning("تعذّر حفظ/تقييم full_call.wav: %s", e)

    async def _report_transcript(self) -> str:
        """
        التفريغ النهائي: يفرّغ *الملف الكامل المحفوظ* عبر Whisper بوضع دقيق (أدقّ من
        المقاطع المنفصلة لأن الموديل يرى كامل السياق)، ثم ينسب كل جملة للمتحدّث:
          • أساساً: بالمطابقة الزمنية مع المتحدّث *المعروف* من قنوات Discord المنفصلة
            (خريطة _speaker_timeline) — دقّة نسب مثالية بلا تخمين.
          • احتياطاً: فصل من محتوى الكلام عبر الـ LLM لو كان الطرفان على قناة واحدة.
        ثم يسمّي المتحدّثين «الموظف/العميل»، ويعرض النسخة النهائية على اللوحة، ويعيد
        النص المُسمّى للموديل. يعيد "" عند الفشل (يتراجع المتصل للنص الحيّ المسطّح).
        """
        alls = self._full_call_samples()
        if not alls.size:
            return ""
        ranges = self._speaker_timeline()
        try:
            wav = wav_from_mono(alls)   # كامل المكالمة خام 48kHz → whisper_service يعيد أخذ عيّناته
            res = await whisper_service.transcribe_call(wav)
        except Exception as e:
            logger.error("فشل تفريغ التقرير الكامل: %s", e)
            return ""
        utts = (res or {}).get("utterances") or []
        if not utts:
            return ""

        known_names = {name for _, _, name in ranges}
        turns: list[tuple[str, str]] = []
        source = ""
        roled_by_content = False

        # (1) الأدقّ: النسب بالمتحدّث *المعروف* من قنوات Discord المنفصلة (≥2 مستخدمين) —
        #     ground truth بلا تخمين. طابِق منتصف زمن كل جملة بخريطة المزج.
        if ranges and len(known_names) >= 2:
            mapped = [(_name_at(ranges, (u["start"] + u["end"]) / 2.0), u["transcript"])
                      for u in utts]
            merged = _merge_same_speaker(mapped)
            if len({n for n, _ in merged}) >= 2:      # المطابقة فصلت متحدّثَين فعلاً
                turns, source = merged, "known"

        # (2) قناة واحدة (مستخدم Discord واحد = الطرفين على نفس الميكروفون): الفصل الصوتي
        #     (diarization) غير موثوق هنا — أحياناً يرجّع متحدّثاً واحداً وأحياناً متحدّثَين
        #     وهميين — فنفصل من *محتوى الكلام* مباشرةً (أمتن وأثبت لهذا الإعداد).
        if not turns:
            flat_text = "\n".join(u["transcript"] for u in utts).strip()
            try:
                labeled = await llm_svc.attribute_speakers(flat_text)
            except Exception as e:
                logger.error("فشل فصل المتحدّثين من المحتوى: %s", e)
                labeled = []
            if len({r for r, _ in labeled}) >= 2:      # نجح في فصل دورين فعلاً
                turns = _merge_same_speaker(labeled)
                source, roled_by_content = "content", True

        # (3) الملاذ الأخير: تسمية عامة (Whisper لا يفصل المتحدّثين) لو المحتوى ما فصلش.
        if not turns:
            diar = [(whisper_service._speaker_label(int(u.get("speaker", 0) or 0)), u["transcript"])
                    for u in utts]
            turns = _merge_same_speaker(diar)
            source = "diarize"

        if not turns:
            return ""

        # مسار المحتوى بيرجّع أدوار «الموظف/العميل» جاهزة → متعملش _assign_roles تاني
        # (هتعيد التسمية بالأخطاء)؛ باقي المسارات أسماء/أرقام → تحتاج _assign_roles.
        roled = turns if roled_by_content else _assign_roles(turns)
        # صحّح أخطاء التفريغ (ASR) *مع الحفاظ على الأدوار* لو مُفعّل — قبل العرض والتقرير،
        # فالنسخة النهائية على اللوحة وفي التقرير تبقى مصحّحة ومفصولة معاً.
        if config.CORRECTION_ENABLED:
            try:
                fixed = await llm_svc.correct_labeled_turns(roled)
                if fixed:
                    roled = fixed
                    await self.push({"type": "system_log", "level": "INFO",
                                     "message": "✍️ تم تصحيح أخطاء التفريغ (مع حفظ فصل المتحدثين)."})
            except Exception as e:
                logger.warning("تصحيح النص فشل: %s", e)
        n_spk = len({r for r, _ in roled})
        logger.info("🗣️ تفريغ التقرير (%s): %d دور / %d متحدث", source, len(turns), n_spk)
        if n_spk >= 2:
            how = {"known": "من قنوات المكالمة", "content": "من محتوى المكالمة"}.get(source, "تلقائياً")
            await self.push({"type": "system_log", "level": "INFO",
                             "message": f"🗣️ تم فصل المتحدثين ({how}) — {len(roled)} دور"})
        await self.push({"type": "final_transcript",
                         "lines": [{"speaker": role, "text": text} for role, text in roled]})
        lines = [f"[{role}]: {text}" if role else text for role, text in roled]
        return "\n".join(lines)

    # ── الأحداث ──────────────────────────────────────────────────────────────
    async def on_ready(self):
        logger.info("✅ البوت متصل: %s (id=%s)", self.user, self.user.id)
        await self.push({"type": "system_log",
                         "message": f"اتصل بوت Discord: {self.user} ✅", "level": "INFO"})

    async def on_message(self, message: "discord.Message"):
        if message.author.bot:
            return
        content = (message.content or "").strip().lower()

        if content == "!join":
            if message.author.voice and message.author.voice.channel:
                await self._start_monitoring(message.author.voice.channel)
                await message.channel.send(
                    "✅ **بدأت المراقبة اللحظية** — التفريغ والتحليل اللحظي شغّالين، "
                    "والتوجيهات هتظهر على لوحة الموظف.")
            else:
                await message.channel.send("⚠️ ادخل قناة صوتية الأول، وبعدين اكتب `!join`.")

        elif content == "!leave":
            if message.guild and message.guild.voice_client:
                await message.channel.send("👋 جاري إنهاء المكالمة وإعداد التقرير النهائي…")
                await self._stop_monitoring(message.guild)
            else:
                await message.channel.send("ℹ️ مفيش مكالمة نشطة حالياً.")

    async def on_voice_state_update(self, member, before, after):
        if member.bot:
            return
        guild = member.guild

        # انضمام تلقائي بمجرد دخول أول شخص قناة صوتية
        if config.AUTO_JOIN and after.channel and before.channel != after.channel:
            if guild.voice_client is None:
                await self._start_monitoring(after.channel)
                return

        # فصل تلقائي + تقرير عندما تفرغ قناة البوت من البشر
        vc = guild.voice_client
        if vc and vc.channel:
            humans = [m for m in vc.channel.members if not m.bot]
            if not humans:
                await self._stop_monitoring(guild)


# ── واجهات التشغيل ───────────────────────────────────────────────────────────
def create_bot(broadcaster=None) -> CallMonitorBot:
    """ينشئ بوتاً. مرّر broadcaster (async fn) للبثّ المباشر داخل نفس العملية."""
    return CallMonitorBot(broadcaster=broadcaster)


async def run_bot(bot: CallMonitorBot) -> None:
    if not TOKEN:
        logger.error("لا يوجد DISCORD_TOKEN — لن يعمل البوت.")
        return
    try:
        await bot.start(TOKEN)
    except discord.LoginFailure:
        logger.error("❌ توكن Discord غير صالح — حدّث DISCORD_TOKEN في .env.")
    except discord.PrivilegedIntentsRequired:
        logger.error("❌ فعّل 'Message Content Intent' في Discord Developer Portal.")
    except Exception as e:
        logger.error("توقّف بوت Discord: %s", e, exc_info=True)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    # وضع مستقل: يبثّ للـ Dashboard عبر HTTP (لازم app.py يكون شغّالاً)
    asyncio.run(run_bot(create_bot()))
