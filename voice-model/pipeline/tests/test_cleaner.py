"""
اختبارات وحدة منظّف التفريغ (الخطوة 3 / الخطوة 15).
يعمل مع pytest أو مستقلاً:  python pipeline/tests/test_cleaner.py  (من voice-model/)

يركّز على القاعدة الذهبية: نظّف الإملاء/الأخطاء فقط — بلا فصحنة وبلا تغيير معنى.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from pipeline.text_cleaner import CleanerConfig, TextCleaner, clean_transcript  # noqa: E402

C = TextCleaner()   # منظّف بالقاموس الافتراضي


# ── أمثلة المواصفة الصريحة ───────────────────────────────────────────────────
def test_spec_example_full_sentence():
    assert C.clean("انا هابعتلك الفلوس بكره") == "أنا هبعتلك الفلوس بكرة."


def test_spec_example_keeps_dialect_unchanged():
    # «تمام يا باشا» تفضل زي ما هي — ممنوع تتحوّل لفصحى («حسنًا يا سيدي»).
    assert C.clean("تمام يا باشا") == "تمام يا باشا"


def test_no_msa_translation_short():
    assert C.clean("معلش يا باشا") == "معلش يا باشا"


def test_dialect_words_preserved_in_long_sentence():
    out = C.clean("خلاص يا باشا انا ماشي كده")
    for w in ("خلاص", "ماشي", "كده"):
        assert w in out, f"كلمة لهجة اتغيّرت: {w}"
    assert "أنا" in out          # التصحيح الإملائي الوحيد المسموح


# ── القواعد العامة الآمنة ────────────────────────────────────────────────────
def test_collapse_consecutive_word_repeat():
    assert C.clean("النت النت مقطوع") == "النت مقطوع"


def test_collapse_letter_run():
    assert C.clean("ياااا باشا") == "يا باشا"


def test_tatweel_removed():
    assert C.clean("الــنت مقطـوع") == "النت مقطوع"


def test_repeated_question_marks():
    assert C.clean("ايه؟؟؟") == "ايه؟"


def test_space_before_punctuation_removed():
    assert C.clean("كده ؟") == "كده؟"


def test_terminal_period_added_for_long():
    assert C.clean("النت مقطوع من امبارح ومحدش بيرد").endswith(".")


def test_no_terminal_period_for_short():
    assert not C.clean("النت مقطوع").endswith(".")


def test_embedded_word_not_corrupted():
    # «روتر» المستقلة تتصحّح، لكن جوّه «والراوتر» ما تتلمسش (حدود الكلمة).
    assert "والراوتر" in C.clean("والراوتر بايظ")


# ── المتانة ─────────────────────────────────────────────────────────────────
def test_idempotent():
    for s in ["انا هابعتلك الفلوس بكره", "تمام يا باشا",
              "ياااا باشا", "النت النت مقطوع", "ايه؟؟؟"]:
        once = C.clean(s)
        assert C.clean(once) == once, f"غير مُتساوٍ عند التكرار: {s!r}"


def test_empty_and_whitespace_passthrough():
    assert C.clean("") == ""
    assert C.clean("   ") == "   "


def test_never_raises_on_weird_input():
    for s in ["؟؟؟؟", "١٢٣٤", "a" * 6, "\n\n", "…", "‏‎", "..."]:
        C.clean(s)   # يكفي ألا يرمي استثناء


def test_all_rules_disabled_is_passthrough():
    cfg = CleanerConfig(
        remove_tatweel=False, collapse_letter_runs=False, normalize_whitespace=False,
        apply_dictionary=False, collapse_word_repeats=False,
        normalize_punctuation=False, add_terminal_punctuation=False,
    )
    c = TextCleaner(config=cfg)
    s = "انا هابعتلك بكره"
    assert c.clean(s) == s


def test_module_level_helper():
    assert clean_transcript("انا هابعتلك الفلوس بكره") == "أنا هبعتلك الفلوس بكرة."


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
