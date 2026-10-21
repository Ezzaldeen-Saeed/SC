"""
Whisper Service — محرّك التفريغ المحلي الوحيد
──────────────────────────────────────────────
تفريغ صوتي محلي بالكامل عبر faster-whisper (CTranslate2) — بلا أي API خارجي.
النموذج الافتراضي: large-v3 (أقوى نسخة Whisper وأدقّها للعربية) على GPU لو موجود.

يُستخدم في مسارين (نفس النموذج المُحمّل مرة واحدة):
  • الحيّ (transcribe_wav): نداء سريع لكل مقطع كلام → نص فوري يظهر على اللوحة.
  • التقرير (transcribe_call): نداء أدقّ على كامل المكالمة مع أزمنة المقاطع، فيقدر
    البوت ينسب كل جملة للمتحدّث المعروف (من قنوات Discord) بالمطابقة الزمنية.

الصوت الوارد من البوت 48kHz مونو (معدّل Discord الأصلي)؛ هنا نعيد أخذ العيّنات إلى
16kHz (المعدّل الذي يتوقّعه Whisper) بمرشّح مضادّ للتشويه قبل التفريغ.
"""

import io
import math
import os
import wave
import asyncio
import logging
import threading

import numpy as np

try:
    from scipy.signal import resample_poly            # إعادة عيّنات احترافية (polyphase)
    _HAVE_SCIPY = True
except ImportError:                                    # تراجع بسيط لو scipy مش مثبّت
    _HAVE_SCIPY = False

logger = logging.getLogger("whisper")

_TARGET_SR = 16_000          # المعدّل الذي يعمل عليه Whisper داخلياً


# ══════════════════════════════════════════════════════════════════════════════
#  تجهيز مسار مكتبات CUDA على ويندوز — لازم *قبل* استيراد faster-whisper
# ══════════════════════════════════════════════════════════════════════════════
_dll_dirs_added = False

def _prepare_cuda_dll_path() -> None:
    """على ويندوز: يضيف مجلّدات DLL لـ CUDA (من حِزم nvidia-*-cu12) لمسار بحث الـ DLL
    و‏PATH، حتى يجد CTranslate2 مكتبات cublas/cudnn/cudart وقت التشغيل. لازم يتنفّذ *قبل*
    استيراد faster_whisper (تحميل ctranslate2.dll) عشان سلسلة اعتماديات cublas تتحلّ صح.
    بدونه يفشل تشغيل الـ GPU بخطأ 'cublas64_12.dll is not found'. لا يفعل شيئاً على غير ويندوز."""
    global _dll_dirs_added
    if _dll_dirs_added or os.name != "nt":
        return
    import glob
    bins: list[str] = []
    try:                                               # الأدقّ: من حزمة nvidia مباشرةً
        import nvidia
        for root in nvidia.__path__:
            bins += glob.glob(os.path.join(root, "*", "bin"))
    except Exception:
        pass
    if not bins:                                       # تراجع: ابحث في site-packages
        import site
        roots: list[str] = []
        try:
            roots += list(site.getsitepackages())
        except Exception:
            pass
        try:
            roots.append(site.getusersitepackages())
        except Exception:
            pass
        for r in roots:
            bins += glob.glob(os.path.join(r, "nvidia", "*", "bin"))
    bins = [b for b in dict.fromkeys(bins) if os.path.isdir(b)]   # فريدة وموجودة
    for b in bins:
        try:
            os.add_dll_directory(b)                     # Python 3.8+ على ويندوز
        except Exception:
            pass
    if bins:
        os.environ["PATH"] = os.pathsep.join(bins) + os.pathsep + os.environ.get("PATH", "")
        logger.info("[Whisper] هُيّئ مسار %d مجلّد DLL لـ CUDA (لتشغيل الـ GPU).", len(bins))
    _dll_dirs_added = True


_prepare_cuda_dll_path()                               # قبل الاستيراد التالي مباشرةً

from faster_whisper import WhisperModel                 # noqa: E402 (بعد تهيئة مسار CUDA)

import config                                           # noqa: E402


# ── منظّف التفريغ الحتمي (pipeline.text_cleaner، الخطوة 3) — اختياري وآمن ──────
# نستورده بحذر: لو الحزمة ناقصة لأي سبب، التفريغ يكمل بالنص الخام بلا أي كسر.
try:
    from pipeline.text_cleaner import clean_transcript as _clean_transcript
    _HAVE_CLEANER = True
except Exception as _e:                                 # noqa: BLE001
    logger.warning("[Whisper] منظّف التفريغ غير متاح (%s) — التفريغ الخام يكمل عادي.", _e)
    _HAVE_CLEANER = False


def _maybe_clean(text: str) -> str:
    """ينظّف النص عبر pipeline.text_cleaner لو مُفعّل ومتاح؛ وإلا يعيده كما هو (آمن).
    حتمي (بلا LLM) ويحافظ على اللهجة المصرية — يغيّر النص فقط, لا يمسّ الأزمنة."""
    if not text or not _HAVE_CLEANER or not getattr(config, "TEXT_CLEANER_ENABLED", True):
        return text
    try:
        return _clean_transcript(text) or text
    except Exception as e:                              # noqa: BLE001
        logger.debug("[Whisper] تخطّي التنظيف (%s)", e)
        return text


# ══════════════════════════════════════════════════════════════════════════════
#  Hotwords قابلة للتعديل: مصطلحات config + مصطلحات القاموس المصري (company_terms)
# ══════════════════════════════════════════════════════════════════════════════
def _build_hotwords() -> str:
    """يبني سلسلة hotwords من مصطلحات config + مصطلحات القاموس المصري القابلة للتحرير
    (company_terms) بلا تكرار — فتتعدّل القائمة بدون كود عبر egyptian_dictionary.json."""
    base = (config.WHISPER_HOTWORDS or "").strip()
    extra: list[str] = []
    try:
        from pipeline.dictionary import get_dictionary
        for term in get_dictionary().company_terms:
            if term and term not in base:              # تفادي التكرار الواضح (سلسلة تحيّز)
                extra.append(term)
    except Exception as e:                              # noqa: BLE001
        logger.debug("[Whisper] hotwords من القاموس غير متاحة (%s)", e)
    return (base + " " + " ".join(extra)).strip() if extra else base


_HOTWORDS = _build_hotwords()


# ══════════════════════════════════════════════════════════════════════════════
#  تحليل الثقة (Confidence Analysis) من مقاييس Whisper نفسها
# ══════════════════════════════════════════════════════════════════════════════
def _segment_confidence(avg_logprob) -> float:
    """يحوّل avg_logprob (متوسط لوغاريتم احتمال التوكن) إلى ثقة 0..1 عبر exp — آمن ضد None."""
    if avg_logprob is None:
        return 0.0
    try:
        return float(math.exp(avg_logprob))
    except (OverflowError, ValueError, TypeError):
        return 0.0


def _seg_metrics(seg) -> dict:
    """يستخرج مقاييس ثقة المقطع من كائن Whisper Segment (آمن ضد اختلاف الإصدارات):
    avg_logprob · compression_ratio · no_speech_prob · أقل احتمال كلمة · ثقة مشتقّة."""
    alp = getattr(seg, "avg_logprob", None)
    words = getattr(seg, "words", None) or []
    probs = [getattr(w, "probability", None) for w in words]
    probs = [float(p) for p in probs if isinstance(p, (int, float))]
    return {
        "avg_logprob":       alp,
        "compression_ratio": getattr(seg, "compression_ratio", None),
        "no_speech_prob":    getattr(seg, "no_speech_prob", None),
        "min_word_prob":     (min(probs) if probs else None),
        "confidence":        _segment_confidence(alp),
    }


def _is_low_confidence(m: dict) -> bool:
    """هل المقطع منخفض الثقة؟ (أي مقياس يتجاوز عتبته القابلة للضبط في config)."""
    alp = m.get("avg_logprob")
    cr  = m.get("compression_ratio")
    nsp = m.get("no_speech_prob")
    mwp = m.get("min_word_prob")
    if alp is not None and alp < config.WHISPER_CONF_LOGPROB_MIN:
        return True
    if cr is not None and cr > config.WHISPER_CONF_COMPRESSION_MAX:
        return True
    if nsp is not None and nsp > config.WHISPER_CONF_NO_SPEECH_MAX:
        return True
    if mwp is not None and mwp < config.WHISPER_CONF_MIN_WORD_PROB:
        return True
    return False


# ── كلمات وهمية شائعة يولّدها Whisper على صوت فارغ/تشويش (هلوسة) ───────────────
_HALLUCINATIONS = frozenset([
    "اتحدث بالعربي", "ترجمة", "شكرا", "إلى اللقاء", "لا تنسوا الاشتراك",
    "Subtitles", "أنت جدا", "تحدث باللغة", "MBC", "شكراً لكم", "للمزيد من",
    "الشهرور", "أشترك في القناة", "اشترك في القناة", "صوت", "موسيقى",
    "Thank you", "Thanks for watching", ".", "هذه مكالمة خدمة عملاء",
])


# ══════════════════════════════════════════════════════════════════════════════
#  اختيار الجهاز ونوع الحساب (GPU تلقائياً مع تراجع آمن لـ CPU)
# ══════════════════════════════════════════════════════════════════════════════
def _cuda_available() -> bool:
    """هل يوجد GPU من NVIDIA قابل للاستخدام مع CTranslate2؟ (فحص خفيف عبر ctranslate2)."""
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def _resolve_device_and_compute() -> "tuple[str, str]":
    """
    يحسم (device, compute_type) من الإعدادات مع منطق افتراضي ذكي:
      • WHISPER_DEVICE=auto  → cuda لو موجود وإلا cpu.
      • compute افتراضي على cuda = int8_float16 (دقّة large-v3 كاملة عملياً + ذاكرة
        أقل ~3GB، فيتعايش مع موديل الـ LLM المحلي على كارت 8GB). على cpu = int8.
      • float16 على CPU غير مدعوم → نصحّحه تلقائياً إلى int8.
    """
    want = (config.WHISPER_DEVICE or "auto").lower()
    if want == "auto":
        device = "cuda" if _cuda_available() else "cpu"
    else:
        device = want
        if device == "cuda" and not _cuda_available():
            logger.warning("[Whisper] WHISPER_DEVICE=cuda لكن لا GPU متاح — التراجع إلى CPU.")
            device = "cpu"

    compute = (config.WHISPER_COMPUTE_TYPE or "").lower().strip()
    if not compute:
        compute = "int8_float16" if device == "cuda" else "int8"
    # أنواع float على CPU غير مناسبة — اضبطها إلى int8 لتفادي أخطاء التحميل
    if device == "cpu" and compute not in ("int8", "int8_float32", "float32"):
        logger.info("[Whisper] '%s' غير مناسب على CPU — استخدام int8.", compute)
        compute = "int8"
    return device, compute


def _warmup(model: "WhisperModel") -> None:
    """تفريغ وهمي قصير يجبر تحميل مكتبات CUDA (cublas/cudnn) وقت التحميل بدل أول نداء —
    فأي نقص في المكتبات يظهر هنا فنتراجع لـ CPU بأمان (لا نكتشفه متأخراً في أول مكالمة)."""
    dummy = (np.random.randn(_TARGET_SR) * 0.01).astype(np.float32)   # ثانية ضوضاء خفيفة
    segments, _ = model.transcribe(dummy, language=config.WHISPER_LANGUAGE,
                                   beam_size=1, vad_filter=False)
    for _seg in segments:              # استهلاك المولّد يُشغّل الـ encoder (يحمّل cublas)
        break


def _load_model(model_ref: str) -> "WhisperModel":
    """يحمّل نموذج faster-whisper مع تراجع آمن من GPU إلى CPU عند فشل مكتبات CUDA."""
    _prepare_cuda_dll_path()                     # اجعل DLLات CUDA قابلة للتحميل (ويندوز)
    device, compute = _resolve_device_and_compute()
    kind = "مسار محلي" if os.path.isdir(model_ref) else "اسم"
    try:
        logger.info("[Whisper] تحميل (%s) '%s' على %s (%s)…", kind, model_ref, device, compute)
        model = WhisperModel(
            model_ref,
            device       = device,
            compute_type = compute,
            cpu_threads  = config.WHISPER_CPU_THREADS,
            num_workers  = config.WHISPER_NUM_WORKERS,
        )
        if device == "cuda":
            _warmup(model)                       # يُجبر تحميل cublas/cudnn الآن (يلتقط النقص مبكراً)
        logger.info("[Whisper] ✅ الموديل جاهز: '%s' @ %s (%s)", model_ref, device, compute)
        return model
    except Exception as e:
        if device == "cuda":
            logger.error("[Whisper] ❌ فشل تشغيل GPU (%s) — التراجع إلى CPU/int8. لتشغيل الـ GPU "
                         "ثبّت مكتبات CUDA: pip install nvidia-cublas-cu12 nvidia-cudnn-cu12", e)
            model = WhisperModel(model_ref, device="cpu", compute_type="int8",
                                 cpu_threads=config.WHISPER_CPU_THREADS,
                                 num_workers=config.WHISPER_NUM_WORKERS)
            logger.info("[Whisper] ✅ الموديل جاهز على CPU (int8): '%s'", model_ref)
            return model
        raise


# ══════════════════════════════════════════════════════════════════════════════
#  الخدمة
# ══════════════════════════════════════════════════════════════════════════════
class WhisperService:
    def __init__(self, model_ref: str, *, fallback: str = "small"):
        """model_ref: اسم موديل (small/medium/large-v3…) أو مسار مجلّد CT2 محلي.
        fallback: يُحمَّل لو فشل تحميل model_ref (اسم غلط/موديل تالف)."""
        self.model_ref = model_ref
        self._lock = threading.Lock()          # يمنع نداءين متزامنين على نفس الموديل
        try:
            self.model = _load_model(model_ref)
        except Exception as e:
            logger.error("[Whisper] تعذّر تحميل '%s' (%s) — التراجع إلى '%s'",
                         model_ref, e, fallback)
            self.model = _load_model(fallback)
            self.model_ref = fallback

    # ── واجهة async: الحيّ (سريع) ─────────────────────────────────────────────
    async def transcribe(self, wav_bytes: bytes) -> str:
        """يفرّغ مقطع WAV واحد ويعيد النص المسطّح (وضع حيّ سريع). "" عند الصمت/الفشل."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._transcribe_sync, wav_bytes, False)

    # ── واجهة async: التقرير (أدقّ، مع أزمنة المقاطع) ──────────────────────────
    async def transcribe_timed(self, wav_bytes: bytes) -> dict:
        """يفرّغ كامل المكالمة ويعيد {utterances:[{start,end,transcript,speaker}], flat}
        (وضع دقيق). الأزمنة بالثواني تسمح للبوت بنسب كل جملة للمتحدّث المعروف."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._transcribe_timed_sync, wav_bytes)

    # ── النواة المتزامنة: الحيّ ────────────────────────────────────────────────
    def _transcribe_sync(self, wav_bytes: bytes, accurate: bool) -> str:
        try:
            audio = _wav_bytes_to_16k_mono(wav_bytes)
            if audio is None or len(audio) < _TARGET_SR // 2:      # < 0.5 ثانية
                return ""
            rms = float(np.sqrt(np.mean(audio ** 2)))
            if rms < 0.004:                                        # مقطع صامت عملياً
                return ""
            segs = self._run(audio, accurate=accurate,
                             beam_size=config.WHISPER_BEAM_SIZE, want_times=False)
            text = " ".join(s["transcript"] for s in segs).strip()
            if _is_hallucination(text):
                return ""
            text = _maybe_clean(text)              # تنظيف حتمي (الخطوة 3) — يحافظ على اللهجة
            logger.info("[Whisper] rms=%.4f dur=%.1fs → %r", rms, len(audio) / _TARGET_SR, text[:80])
            return text
        except Exception as e:
            logger.error("[Whisper] خطأ في التفريغ الحيّ: %s", e, exc_info=True)
            return ""

    # ── النواة المتزامنة: التقرير ─────────────────────────────────────────────
    def _transcribe_timed_sync(self, wav_bytes: bytes) -> dict:
        try:
            audio = _wav_bytes_to_16k_mono(wav_bytes)
            if audio is None or len(audio) < _TARGET_SR // 2:
                return {"utterances": [], "flat": ""}
            segs = self._run(audio, accurate=True,
                             beam_size=config.WHISPER_REPORT_BEAM, want_times=True)
            # إعادة تفريغ تكيّفية للمقاطع منخفضة الثقة *وحدها* (الخطوة 6 + 9): ترفع الدقّة
            # على المقاطع الصعبة بأقل تكلفة — لا نعيد تفريغ المكالمة كلها.
            if config.WHISPER_ADAPTIVE_RETRANSCRIBE:
                segs = self._retranscribe_low_confidence(audio, segs)
            # تنظيف حتمي لكل مقطع مع الحفاظ على أزمنته (الخطوة 3): الأزمنة تبقى تنسب
            # الجُمل للمتحدّث المعروف بدقة، والنص يبقى أنضف للتقرير وفصل المتحدّثين.
            utts: list[dict] = []
            for s in segs:
                t = s["transcript"]
                if not t or _is_hallucination(t):
                    continue
                t = _maybe_clean(t)
                if not t:
                    continue
                utts.append({"start": s["start"], "end": s["end"],
                             "transcript": t, "speaker": 0})
            flat = " ".join(u["transcript"] for u in utts).strip()
            return {"utterances": utts, "flat": flat}
        except Exception as e:
            logger.error("[Whisper] خطأ في تفريغ التقرير: %s", e, exc_info=True)
            return {"utterances": [], "flat": ""}

    # ── إعادة التفريغ التكيّفية (Adaptive Re-Transcription) — المقاطع منخفضة الثقة ─
    def _retranscribe_low_confidence(self, audio: np.ndarray,
                                     segs: "list[dict]") -> "list[dict]":
        """يعيد تفريغ المقاطع منخفضة الثقة *وحدها* بإعدادات أدقّ، ويستبدل النص فقط لو
        تحسّنت ثقته. محدود بسقف (WHISPER_RETRANSCRIBE_MAX) حفاظاً على الأداء (الخطوة 9)."""
        low = [(i, s) for i, s in enumerate(segs) if _is_low_confidence(s)]
        if not low:
            return segs
        low.sort(key=lambda x: x[1].get("confidence", 0.0))    # الأسوأ ثقةً أولاً
        low = low[: max(0, config.WHISPER_RETRANSCRIBE_MAX)]
        improved = 0
        for i, s in low:
            new = self._retranscribe_slice(audio, s.get("start", 0.0), s.get("end", 0.0))
            if not new:
                continue
            nt = new["transcript"]
            # استبدل فقط لو النص الجديد غير مهلوس وثقته أعلى من الأصلي.
            if nt and not _is_hallucination(nt) and new["confidence"] > s.get("confidence", 0.0):
                segs[i] = {**s, "transcript": nt, "confidence": new["confidence"],
                           "avg_logprob": new.get("avg_logprob", s.get("avg_logprob"))}
                improved += 1
        logger.info("[Whisper] إعادة تفريغ تكيّفية: فحص %d مقطع منخفض الثقة، تحسّن %d",
                    len(low), improved)
        return segs

    def _retranscribe_slice(self, audio: np.ndarray, start: float,
                            end: float) -> "dict | None":
        """يعيد تفريغ شريحة زمنية (مع حاشية سياق ±0.3ث) بإعدادات أدقّ (beam أعلى، بلا VAD).
        يعيد {transcript, confidence, avg_logprob} أو None لو الشريحة صغيرة/فشلت."""
        pad = 0.30
        a = max(0, int((start - pad) * _TARGET_SR))
        b = min(len(audio), int((end + pad) * _TARGET_SR))
        if b - a < _TARGET_SR // 5:                    # < 0.2 ثانية — صغيرة جداً
            return None
        segs = self._run(audio[a:b], accurate=True,
                         beam_size=config.WHISPER_RETRANSCRIBE_BEAM,
                         want_times=False, vad=False)
        if not segs:
            return None
        text = " ".join(s["transcript"] for s in segs).strip()
        if not text:
            return None
        confs = [s.get("confidence", 0.0) for s in segs]
        alps  = [s.get("avg_logprob") for s in segs if s.get("avg_logprob") is not None]
        return {"transcript": text,
                "confidence": (sum(confs) / len(confs)) if confs else 0.0,
                "avg_logprob": (sum(alps) / len(alps)) if alps else None}

    # ── تشغيل الموديل مرة ويعيد مقاطع {start,end,transcript + مقاييس ثقة} ─────────
    def _run(self, audio: np.ndarray, *, accurate: bool, beam_size: int,
             want_times: bool, vad: bool = True) -> "list[dict]":
        # إعدادات دقّة مُحسّنة للمصري: beam أوسع + best_of + patience + عقوبة تكرار +
        # initial_prompt (تمهيد لهجة/مصطلحات) + hotwords قابلة للتعديل + VAD أقصر للصمت.
        kwargs = dict(
            language             = config.WHISPER_LANGUAGE,
            beam_size            = max(1, beam_size),
            best_of              = max(1, config.WHISPER_BEST_OF),
            patience             = max(1.0, config.WHISPER_PATIENCE),
            repetition_penalty   = config.WHISPER_REPETITION_PENALTY,
            no_repeat_ngram_size = 3,                  # يكسر حلقات التكرار
            hotwords             = _HOTWORDS or None,
            initial_prompt       = config.WHISPER_INITIAL_PROMPT or None,
            # التقرير (want_times) يفعّل أزمنة الكلمات دائماً (يحتاجها لتحليل الثقة)؛
            # الحيّ يتبع الإعداد (افتراضي True) — أطفئه للحيّ لو احتجت أقصى سرعة.
            word_timestamps      = bool(want_times) or config.WHISPER_WORD_TIMESTAMPS,
            vad_filter           = vad,
            vad_parameters       = dict(min_silence_duration_ms=config.WHISPER_VAD_MIN_SILENCE_MS,
                                        speech_pad_ms=config.WHISPER_VAD_SPEECH_PAD_MS),
        )
        if accurate:
            # وضع التقرير: تراجُع حراري + سياق + عتبات تُسقط الهلوسة (لغات أجنبية…)
            kwargs.update(
                temperature                 = [0.0, 0.2, 0.4, 0.6, 0.8],
                condition_on_previous_text  = True,
                compression_ratio_threshold = 2.4,
                log_prob_threshold          = -1.0,
                no_speech_threshold         = 0.6,
            )
        else:
            # وضع الحيّ: جشِع وسريع، وبلا سياق سابق (يمنع تسرّب الهلوسة بين المقاطع)
            kwargs.update(temperature=0.0, condition_on_previous_text=False)

        def _collect(segs) -> "list[dict]":
            rows: list[dict] = []
            for seg in segs:                           # المولّد كسول — نستهلكه داخل القفل
                t = (seg.text or "").strip()
                if t:
                    rows.append({"start": float(seg.start or 0.0),
                                 "end": float(seg.end or 0.0),
                                 "transcript": t, **_seg_metrics(seg)})
            return rows

        with self._lock:                               # نداء واحد في المرة على الموديل
            segments, _info = self.model.transcribe(audio, **kwargs)
            out = _collect(segments)
        # محاولة ثانية بلا VAD لو ابتلع الكلام كله (شائع على صوت مُعاد أخذ عيّناته)
        if not out and kwargs.get("vad_filter"):
            kwargs["vad_filter"] = False
            with self._lock:
                segments, _info = self.model.transcribe(audio, **kwargs)
                out = _collect(segments)
        return out


# ══════════════════════════════════════════════════════════════════════════════
#  مساعدات الصوت
# ══════════════════════════════════════════════════════════════════════════════
def _wav_bytes_to_16k_mono(wav_bytes: bytes) -> "np.ndarray | None":
    """يقرأ WAV بأي معدّل عيّنات (16k/48k…) ويعيد float32 مونو 16kHz بين -1 و 1 —
    الصيغة التي يتوقّعها faster-whisper. يعيد عيّنات معاد أخذها بمرشّح مضادّ للتشويه."""
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            sr       = wf.getframerate() or _TARGET_SR
            channels = wf.getnchannels() or 1
            width    = wf.getsampwidth() or 2
            frames   = wf.readframes(wf.getnframes())
        if width != 2:                                 # نفترض 16-bit (كما يبعت البوت)
            return None
        samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        if channels == 2 and samples.size:             # ستيريو → مونو
            samples = samples[: (samples.size // 2) * 2].reshape(-1, 2).mean(axis=1)
        if sr != _TARGET_SR and samples.size:          # 48k (أو غيره) → 16k
            samples = _resample_to_16k(samples, sr)
        return samples.astype(np.float32)
    except Exception as e:
        logger.error("[Whisper] فشل قراءة WAV: %s", e)
        return None


def _resample_to_16k(samples: np.ndarray, sr: int) -> np.ndarray:
    """إعادة أخذ العيّنات إلى 16kHz. تستخدم scipy (polyphase مضادّ للتشويه) لو متاحة،
    وإلا تراجع خطّي بسيط (أقل جودة لكنه يعمل)."""
    if _HAVE_SCIPY:
        return resample_poly(samples, _TARGET_SR, sr).astype(np.float32)
    # تراجع: استيفاء خطّي (بدون مرشّح مضادّ للتشويه)
    n_out = int(round(len(samples) * _TARGET_SR / sr))
    if n_out <= 0:
        return np.zeros(0, np.float32)
    x_old = np.linspace(0.0, 1.0, num=len(samples), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    return np.interp(x_new, x_old, samples).astype(np.float32)


def _is_hallucination(text: str) -> bool:
    """يرشّح النصوص الوهمية القصيرة (صمت/تشويش). الجُمل الطويلة لا تُرفض لمجرد احتوائها
    كلمة شائعة مثل «شكرا» — كان ذلك يُسقط نصف المكالمة."""
    t = (text or "").strip()
    if len(t) < 3:
        return True
    if t in _HALLUCINATIONS:
        return True
    if len(t) <= 16:
        for bad in _HALLUCINATIONS:
            if len(bad) >= 3 and bad in t:
                return True
    if all(c in "0123456789.،,؟!- \t\n" for c in t):    # كله أرقام/ترقيم
        return True
    return False


# ── تسمية احتياطية للمتحدّث (يُستخدم فقط كملاذ أخير في مسار التقرير) ──────────
_SPEAKER_AR = {0: "متحدث ١", 1: "متحدث ٢", 2: "متحدث ٣", 3: "متحدث ٤"}

def _speaker_label(spk: int) -> str:
    return _SPEAKER_AR.get(spk, f"متحدث {spk + 1}")


# ══════════════════════════════════════════════════════════════════════════════
#  واجهة الوحدة (module-level) — يستخدمها البوت مباشرةً
# ══════════════════════════════════════════════════════════════════════════════
def _resolve_ref(path: str, name: str) -> str:
    """أولوية التحميل: مسار CT2 محلي صالح ← اسم الموديل (يُنزَّل من HuggingFace أول مرة)."""
    return path if (path and os.path.isdir(path)) else name


# النموذج الحيّ — يُحمّل مرة واحدة عند الاستيراد.
_LIVE_REF = _resolve_ref(config.WHISPER_LOCAL_MODEL_PATH, config.WHISPER_MODEL)
_live_service = WhisperService(_LIVE_REF)

# نموذج التقرير — نفس النموذج افتراضياً (تحميل واحد)؛ أو أقوى لو ضُبط REPORT مختلفاً.
_report_service: "WhisperService | None" = None


def _get_report_service() -> "WhisperService":
    global _report_service
    if _report_service is None:
        ref = _resolve_ref(config.WHISPER_REPORT_MODEL_PATH, config.WHISPER_REPORT_MODEL)
        if ref == _LIVE_REF:
            _report_service = _live_service                # نفس النموذج — لا تُحمّل مرتين
        else:
            logger.info("[Whisper] تحميل نموذج التقرير '%s' (مرة واحدة)…", ref)
            _report_service = WhisperService(ref)
    return _report_service


def is_ready() -> bool:
    """المحرّك المحلي جاهز دائماً بمجرد تحميل النموذج (لا مفتاح ولا شبكة)."""
    return _live_service is not None and getattr(_live_service, "model", None) is not None


async def transcribe_wav(wav_bytes: bytes) -> str:
    """تفريغ حيّ لمقطع واحد → نص. (توقيع بسيط: بلا session — كله محلي)."""
    return await _live_service.transcribe(wav_bytes)


async def transcribe_call(wav_bytes: bytes) -> dict:
    """تفريغ التقرير لكامل المكالمة → {utterances:[{start,end,transcript,speaker}], flat}."""
    return await _get_report_service().transcribe_timed(wav_bytes)
