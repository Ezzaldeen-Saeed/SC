"""
اختبارات مفسّر اللهجة المصرية (الخطوة 4 / الخطوة 15).
يعمل مع pytest أو مستقلاً:  python pipeline/tests/test_dialect.py  (من voice-model/)
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from pipeline.dialect import (  # noqa: E402
    DialectHint,
    EgyptianDialectInterpreter,
    hint_block,
    interpret,
)

I = EgyptianDialectInterpreter()


def _terms(hints):
    return {h.term for h in hints}


def _by_term(hints, term):
    return next(h for h in hints if h.term == term)


# ── أمثلة المواصفة: اكتشاف المقصود الضمني ────────────────────────────────────
def test_weak_commitment_detected():
    hints = I.interpret("طيب هحاول اظبطها بكرة")
    weak = [h for h in hints if h.category == "commitment" and h.strength == "weak"]
    assert weak, "لم يُكتشف التزام ضعيف"


def test_spec_examples_present():
    # كل الأمثلة اللي في المواصفة لازم تتعرف (كصيغة مجرّدة أو داخل عبارة أطول).
    cases = {
        "ربنا يسهل": "ربنا يسهل",
        "معلش يا فندم": "معلش",
        "ماشي كده": "ماشي",
        "تمام": "تمام",
        "يا باشا": "يا باشا",
        "هشوف الموضوع": "هشوف",
        "بعد إذنك": "بعد إذنك",
        "ابقى كلمني": "ابقى",
    }
    for text, term in cases.items():
        detected = _terms(I.interpret(text))
        assert any(term in d for d in detected), f"لم يُكتشف: {term} في {text!r}"


def test_strong_vs_weak_commitment_distinguished():
    weak = _by_term(I.interpret("هحاول اشوفلك حل"), "هحاول")
    strong = _by_term(I.interpret("هظبطهالك دلوقتي"), "هظبطهالك")
    assert weak.strength == "weak" and strong.strength == "strong"


# ── التنقيح السياقي ──────────────────────────────────────────────────────────
def test_negation_flagged():
    hints = I.interpret("لأ انا مش تمام مع الكلام ده")
    assert _by_term(hints, "تمام").negated is True


def test_negation_render_marks_manfy():
    h = _by_term(I.interpret("مش تمام"), "تمام")
    assert h.render().startswith("«تمام» = منفي")


def test_no_false_positive_on_unrelated_text():
    assert I.interpret("عايز اكلم مسؤول عن الفاتورة") == []


def test_dedup_repeated_term():
    hints = I.interpret("تمام تمام تمام")
    assert len([h for h in hints if h.term == "تمام"]) == 1


# ── كتلة التلميحات (الحقن في البرومبت) ───────────────────────────────────────
def test_hint_block_format_and_priority():
    block = I.hint_block("تمام يا فندم بس هحاول اشوف الموضوع")
    assert block.startswith("تلميحات لهجة")
    assert "هحاول" in block
    # الالتزام الضعيف (هحاول) أهم من الموافقة (تمام) → يظهر أعلى.
    assert block.index("هحاول") < block.index("تمام")


def test_hint_block_empty_when_nothing():
    assert I.hint_block("الفاتورة وصلت النهارده") == ""


def test_hint_block_respects_max():
    block = I.hint_block("تمام ماشي حاضر أيوة معلش يا باشا حضرتك", max_hints=2)
    assert block.count("\n- ") == 2


# ── التكامل مع القاموس والمتانة ──────────────────────────────────────────────
def test_merges_dictionary_slang():
    # «على فكرة» موجودة في slang بالقاموس مش في المعجم الغني — لازم تتعرف برضه.
    assert "على فكرة" in _terms(I.interpret("على فكرة النت وقع تاني"))


def test_missing_lexicon_is_safe():
    it = EgyptianDialectInterpreter(lexicon_path="__no_such_lexicon__.json")
    # المعجم الغني مفقود، لكن يظل يكمّل من slang القاموس بلا كسر.
    assert isinstance(it.interpret("هحاول"), list)
    assert it.hint_block("") == ""


def test_never_raises_on_weird_input():
    for s in ["", "   ", "؟؟؟", "١٢٣", "\n\n", "مش", "a" * 5]:
        I.interpret(s)
        I.hint_block(s)


def test_module_level_helpers():
    assert "هحاول" in hint_block("هحاول اعمل اللي اقدر عليه")
    assert isinstance(interpret("تمام"), list)


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
