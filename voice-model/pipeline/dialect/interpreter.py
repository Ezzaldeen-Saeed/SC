"""
Egyptian Dialect Interpreter — مفسّر اللهجة المصرية (الخطوة 4)
──────────────────────────────────────────────────────────────
يفهم التعبيرات المصرية الضمنية والردود غير المباشرة، ويطلّع «تلميحات» مختصرة تُحقن
في برومبت التحليل (اللحظي + التقرير) فيفهم الموديل المقصود بدل ما يخمّنه — مثال:
  «هحاول» ⇒ التزام غير مؤكد   ·   «ربنا يسهل» ⇒ تأكيد ضعيف
  «هشوف»  ⇒ رد مؤجّل غير مؤكد  ·   «تمام» ⇒ تأكيد (وقد يكون تهكّماً حسب النبرة)

فلسفة التصميم (مهم): الاكتشاف معجمي (سريع، بلا LLM)، لكن *التفسير النهائي سياقي*:
  • التلميحات تُحقن *مع* سياق المكالمة كاملاً، والموديل (اللي شايف السياق) هو اللي
    يحكم إزاي يستعملها — فمش «keyword matching» أعمى، ده تأريض للموديل السياقي.
  • تنقيح خفيف سياقي هنا كمان: كشف النفي («مش تمام»)، وترتيب التلميحات بأهمّية
    التوجيه (الالتزام الضعيف والرد غير المباشر أولاً).

المعجم قابل للتحرير بدون كود: pipeline/dialect/dialect_lexicon.json
(أو وجّه SCM_DIALECT_LEXICON_PATH لملف خارجي). يكمّله المفسّر بخريطة slang من القاموس
العام تلقائياً. آمن ضد الملفات الناقصة/التالفة، ولا يرمي استثناءً للمتصل أبداً.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

from pipeline.dictionary import EgyptianDictionary, get_dictionary

logger = logging.getLogger("pipeline.dialect")

_DEFAULT_LEXICON_PATH = Path(__file__).with_name("dialect_lexicon.json")

# أوزان أهمّية الفئات للتوجيه (الأعلى يظهر أولاً): الالتزام الضعيف والرد غير المباشر
# أهم بكتير من مجرد الموافقة/النبرة — لأنها بتغيّر حكم الموديل على «هل اتحلّت فعلاً؟».
_CATEGORY_WEIGHT = {
    "commitment": 5, "refusal": 4, "indirect": 4,
    "agreement": 2, "politeness": 1, "tone": 1, "other": 0,
}

# أدوات نفي مصرية شائعة — لو سبقت التعبير مباشرةً نعتبره منفياً («مش تمام»).
_NEG_TOKENS = frozenset({"مش", "مِش", "مو", "ما", "مهو", "مب", "مِهو"})
_NONWORD_RE = re.compile(r"[^\w]", re.UNICODE)


@dataclass(frozen=True)
class DialectHint:
    """تلميح لهجة واحد: التعبير المكتشَف ومعناه الضمني ومعلومات تنقيحه."""
    term: str
    meaning: str
    category: str = "other"
    strength: "str | None" = None
    note: "str | None" = None
    negated: bool = False

    def render(self) -> str:
        core = f"منفي — {self.meaning}" if self.negated else self.meaning
        if self.note:
            core = f"{core} ({self.note})"
        return f"«{self.term}» = {core}"


class EgyptianDialectInterpreter:
    """يكتشف تعبيرات اللهجة في النص ويطلّع تلميحات مقصدها (للحقن في البرومبت)."""

    def __init__(self, lexicon_path: "str | os.PathLike | None" = None,
                 dictionary: "EgyptianDictionary | None" = None) -> None:
        self._dict = dictionary if dictionary is not None else get_dictionary()
        self.path = self._resolve_path(lexicon_path)
        self.version: int = 0
        self._by_term: dict[str, dict] = {}
        self._regex: "re.Pattern | None" = None
        self.reload()

    @staticmethod
    def _resolve_path(path: "str | os.PathLike | None") -> Path:
        if path:
            return Path(path)
        env = os.getenv("SCM_DIALECT_LEXICON_PATH", "").strip()
        return Path(env) if env else _DEFAULT_LEXICON_PATH

    # ── التحميل ───────────────────────────────────────────────────────────
    def reload(self) -> None:
        """يعيد بناء المعجم من القرص + خريطة slang من القاموس (للتحديث بلا إعادة تشغيل)."""
        raw = self._read()
        self.version = _as_int(raw.get("version"))
        by_term: dict[str, dict] = {}

        for expr in raw.get("expressions", []) or []:
            if not isinstance(expr, dict):
                continue
            meaning = str(expr.get("meaning", "")).strip()
            terms = expr.get("terms")
            if not meaning or not isinstance(terms, list):
                continue
            entry = {
                "meaning":  meaning,
                "category": str(expr.get("category", "other")).strip() or "other",
                "strength": _opt_str(expr.get("strength")),
                "note":     _opt_str(expr.get("note")),
            }
            for t in terms:
                if isinstance(t, str) and t.strip():
                    by_term.setdefault(t.strip(), entry)   # أول تعريف يفوز

        # تكميل تلقائي بخريطة slang من القاموس العام (لأي تعبير مش في المعجم الغني).
        for term, meaning in self._dict.slang.items():
            by_term.setdefault(term, {"meaning": meaning, "category": "other",
                                      "strength": None, "note": None})

        self._by_term = by_term
        self._regex = self._build_regex()
        logger.info("[Dialect] حُمّل معجم v%s — %d تعبير (%s)",
                    self.version, len(by_term), self.path.name)

    def _read(self) -> dict:
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("جذر المعجم ليس كائن JSON")
            return data
        except FileNotFoundError:
            logger.warning("[Dialect] الملف غير موجود (%s) — يُكتفى بخريطة القاموس.", self.path)
        except Exception as e:                              # noqa: BLE001
            logger.warning("[Dialect] تعذّر قراءة %s (%s) — يُكتفى بخريطة القاموس.", self.path, e)
        return {}

    def _build_regex(self) -> "re.Pattern | None":
        keys = sorted(self._by_term.keys(), key=len, reverse=True)   # الأطول أولاً
        if not keys:
            return None
        alt = "|".join(re.escape(k) for k in keys)
        return re.compile(r"(?<!\w)(" + alt + r")(?!\w)")

    # ── الاستدلال ─────────────────────────────────────────────────────────
    def interpret(self, text: str, *, context: str = "", speaker: str = "") -> "list[DialectHint]":
        """يكتشف تعبيرات اللهجة في النص ويعيد تلميحاتها (بترتيب ظهورها، بلا تكرار)."""
        if not text or self._regex is None:
            return []
        out: list[DialectHint] = []
        seen: set[str] = set()
        try:
            for m in self._regex.finditer(text):
                term = m.group(1)
                if term in seen:
                    continue
                seen.add(term)
                e = self._by_term.get(term)
                if not e:
                    continue
                out.append(DialectHint(
                    term=term, meaning=e["meaning"], category=e.get("category", "other"),
                    strength=e.get("strength"), note=e.get("note"),
                    negated=self._negated_before(text, m.start()),
                ))
        except Exception as e:                              # noqa: BLE001
            logger.debug("[Dialect] تخطّي الاستدلال (%s)", e)
            return []
        return out

    def hint_block(self, text: str, *, context: str = "", speaker: str = "",
                   max_hints: int = 6) -> str:
        """يبني كتلة تلميحات مختصرة لحقنها في البرومبت، أو "" لو مفيش تعبيرات معروفة."""
        hints = self._prioritize(self.interpret(text, context=context, speaker=speaker))
        if not hints:
            return ""
        lines = "\n".join(f"- {h.render()}" for h in hints[:max(1, max_hints)])
        return "تلميحات لهجة مصرية (المقصود الضمني — للفهم فقط، مش جزء من النص):\n" + lines

    @staticmethod
    def _prioritize(hints: "list[DialectHint]") -> "list[DialectHint]":
        # المنفيّ أولاً (بيغيّر المعنى)، ثم الأعلى وزناً — مع ثبات ترتيب الظهور.
        return sorted(hints, key=lambda h: (0 if h.negated else 1,
                                            -_CATEGORY_WEIGHT.get(h.category, 0)))

    @staticmethod
    def _negated_before(text: str, start: int) -> bool:
        prefix = text[:start].rstrip()
        if not prefix:
            return False
        last = _NONWORD_RE.sub("", prefix.split()[-1])
        return last in _NEG_TOKENS


# ── مساعدات ─────────────────────────────────────────────────────────────────
def _as_int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _opt_str(v) -> "str | None":
    s = str(v).strip() if isinstance(v, str) else ""
    return s or None


# ── Singleton افتراضي ───────────────────────────────────────────────────────
_default_interpreter: "EgyptianDialectInterpreter | None" = None


def get_interpreter() -> EgyptianDialectInterpreter:
    """يعيد المفسّر الافتراضي المشترك (يُبنى كسولاً)."""
    global _default_interpreter
    if _default_interpreter is None:
        _default_interpreter = EgyptianDialectInterpreter()
    return _default_interpreter


def interpret(text: str, *, context: str = "", speaker: str = "") -> "list[DialectHint]":
    """اختصار: يفسّر عبر المفسّر الافتراضي."""
    return get_interpreter().interpret(text, context=context, speaker=speaker)


def hint_block(text: str, *, context: str = "", speaker: str = "", max_hints: int = 6) -> str:
    """اختصار: يبني كتلة تلميحات عبر المفسّر الافتراضي."""
    return get_interpreter().hint_block(text, context=context, speaker=speaker, max_hints=max_hints)
