"""
اختبارات وحدة القاموس المصري (الخطوة 11 / الخطوة 15).
يعمل مع pytest أو مستقلاً:  python pipeline/tests/test_dictionary.py  (من voice-model/)
"""
from __future__ import annotations

import os
import sys

# اجعل جذر voice-model/ على المسار حتى يعمل الاستيراد المستقل وتحت pytest.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from pipeline.dictionary import EgyptianDictionary, get_dictionary  # noqa: E402


def test_default_dictionary_loads():
    d = get_dictionary()
    assert d.version >= 1
    assert d.replacements, "خريطة الاستبدال المدمجة يجب ألا تكون فارغة"


def test_variants_inverted_to_replacements():
    d = EgyptianDictionary()
    assert d.replacements.get("انا") == "أنا"
    assert d.replacements.get("بكره") == "بكرة"
    assert d.replacements.get("هابعتلك") == "هبعتلك"


def test_asr_corrections_present():
    d = EgyptianDictionary()
    assert d.replacements.get("فودا فون") == "فودافون"


def test_protected_terms_present():
    d = EgyptianDictionary()
    assert "تمام" in d.protected
    assert d.is_protected("يا باشا")
    assert not d.is_protected("انا")


def test_no_replacement_source_is_protected_or_identity():
    d = EgyptianDictionary()
    for src, dst in d.replacements.items():
        assert src != dst, f"استبدال بلا تغيير: {src!r}"
        assert src not in d.protected, f"مصدر محميّ داخل الاستبدالات: {src!r}"


def test_slang_meanings():
    d = EgyptianDictionary()
    assert d.meaning("هحاول")            # له معنى ضمني
    assert d.meaning("ربنا يسهل")
    assert d.meaning("لا-يوجد-هذا-التعبير") is None


def test_hotwords_include_company_terms():
    d = EgyptianDictionary()
    hw = d.hotwords()
    assert "فودافون" in hw and "راوتر" in hw


def test_missing_file_is_safe():
    d = EgyptianDictionary(path="__no_such_dictionary_file__.json")
    assert d.replacements == {}
    assert d.protected == frozenset()
    assert d.slang == {}
    assert d.hotwords() == ""


def test_reload_is_stable():
    d = EgyptianDictionary()
    n = len(d.replacements)
    d.reload()
    assert len(d.replacements) == n


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
