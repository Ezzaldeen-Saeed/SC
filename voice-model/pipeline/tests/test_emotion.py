"""
اختبارات محرّك المشاعر المصري (الخطوة 8 / الخطوة 15).
يعمل مع pytest أو مستقلاً:  python pipeline/tests/test_emotion.py  (من voice-model/)
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from pipeline.emotion import EmotionEngine, analyze, realtime_hint, timeline_hint  # noqa: E402

E = EmotionEngine()


# ── الاكتشاف الأساسي (١١ شعور) ───────────────────────────────────────────────
def test_frustration_detected_high():
    r = E.analyze("زهقت بقالي يومين ومحدش بيرد")
    assert r.dominant == "إحباط" and r.intensity == "مرتفع"


def test_anger_detected():
    r = E.analyze("حرام عليكو كفاية بقى هشتكي")
    assert "غضب" in r.scores and r.dominant == "غضب"


def test_satisfaction_detected():
    r = E.analyze("متشكر جداً تسلم حليتوها الحمد لله")
    assert r.dominant == "رضا"


def test_urgency_detected():
    r = E.analyze("محتاجه دلوقتي ضروري وبسرعة")
    assert "استعجال" in r.scores


def test_confusion_detected():
    r = E.analyze("مش فاهم اشرحلي إزاي يعني")
    assert "حيرة" in r.scores


def test_neutral_when_no_cues():
    assert E.analyze("عايز اعرف حالة الطلب").is_neutral()


# ── التنقيح السياقي ──────────────────────────────────────────────────────────
def test_negation_suppresses_emotion():
    # «مش قلقان» ما يحسبش خوف.
    assert "خوف" not in E.analyze("انا مش قلقان خالص").scores


def test_sarcasm_needs_negative_context():
    # مديح ساخر + إحباط ⇒ تهكّم.
    assert "تهكّم" in E.analyze("برافو عليكو بجد وانا زهقت من كتر الكلام").scores
    # نفس المديح بدون سلبية ⇒ مش تهكّم.
    assert "تهكّم" not in E.analyze("برافو عليكو شغل حلو").scores


def test_intensity_scales_with_count():
    assert E.analyze("مستعجل").intensity == "منخفض"
    assert E.analyze("مستعجل وبسرعة").intensity == "متوسط"
    assert E.analyze("مستعجل وبسرعة وضروري").intensity == "مرتفع"


def test_label_format():
    label = E.analyze("زهقت بقالي يومين ومحدش بيرد ومستعجل").label()
    assert label.startswith("إحباط (مرتفع)") and "استعجال" in label


# ── التلميح اللحظي ───────────────────────────────────────────────────────────
def test_realtime_hint_for_negative():
    hint = E.realtime_hint("زهقت ومحدش بيرد")
    assert hint.startswith("قراءة شعورية") and "إحباط" in hint


def test_realtime_hint_empty_for_positive():
    # الرضا مش شعور مُنبِّه ⇒ مفيش تلميح لحظي (تقليل الضجيج).
    assert E.realtime_hint("متشكر تسلم حليتوها") == ""


# ── الخط الزمني (التقرير) ────────────────────────────────────────────────────
def test_timeline_tracks_improvement():
    transcript = (
        "[الموظف]: اهلا بحضرتك معاك احمد\n"
        "[العميل]: زهقت بقالي يومين ومحدش بيرد النت فاصل\n"
        "[الموظف]: انا اسف جداً هفتحلك بلاغ دلوقتي\n"
        "[العميل]: تمام خلاص متشكر جداً حليتوها تسلم"
    )
    hint = E.timeline_hint(transcript)
    assert "تتبّع مشاعر العميل" in hint
    assert "الاتجاه: تحسّن" in hint


def test_timeline_focuses_customer_turns():
    tl = E.timeline(
        "[الموظف]: زهقت مستعجل ضروري\n"   # كلام موظف — يتجاهله الخط الزمني
        "[العميل]: مش فاهم حاجة"
    )
    assert all(p.role == "العميل" for p in tl.points)


def test_timeline_empty_when_no_signals():
    assert E.timeline_hint("[الموظف]: اهلا\n[العميل]: تمام") == ""  # «تمام» رضا؟ لأ، مش ضمن معجم المشاعر


# ── المتانة ─────────────────────────────────────────────────────────────────
def test_missing_lexicon_is_safe():
    e = EmotionEngine(lexicon_path="__no_such_emotion_lexicon__.json")
    assert e.analyze("زهقت").is_neutral()
    assert e.realtime_hint("زهقت") == ""
    assert e.timeline_hint("[العميل]: زهقت") == ""


def test_never_raises_on_weird_input():
    for s in ["", "   ", "؟؟؟", "١٢٣", "\n\n", "مش", "a" * 6]:
        E.analyze(s)
        E.realtime_hint(s)
        E.timeline_hint(s)


def test_module_level_helpers():
    assert not analyze("زهقت").is_neutral()
    assert realtime_hint("زهقت ومحدش بيرد")
    assert isinstance(timeline_hint("[العميل]: زهقت"), str)


if __name__ == "__main__":
    _fns = [(n, f) for n, f in sorted(globals().items())
            if n.startswith("test_") and callable(f)]
    _failed = 0
    for _n, _f in _fns:
        try:
            _f()
            print(f"PASS  {_n}")
        except AssertionError as e:
            _failed += 1
            print(f"FAIL  {_n}: {e}")
        except Exception as e:                      # noqa: BLE001
            _failed += 1
            print(f"ERROR {_n}: {e!r}")
    print(f"\n{len(_fns) - _failed}/{len(_fns)} passed")
    sys.exit(1 if _failed else 0)
