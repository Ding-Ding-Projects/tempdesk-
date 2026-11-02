"""UI string catalogs.

Keys are the English source text (gettext style), so templates read naturally:
``{{ t("Create my sign-in") }}``. Every language file has the same keys; the
test suite checks this. Placeholders use ``{name}`` and are filled after
translation, so data values never pass through the catalog or the personal
wording filter.

Catalog layout::

    {"strings": {"<English>": "<translation>"},
     "fun": {"<English>": {"2": "...", "3": "..."}}}

"fun" holds variants for levels 1 (warm), 2 (friendly) and 3 (playful, with
emoji) for non-critical copy only. Errors and security text never get fun
variants (the test suite checks this), and callers pass serious=True for them.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from markupsafe import Markup, escape

HERE = Path(__file__).parent
LANGS = ("en", "zh-HK")
MODES = ("en", "zh-HK", "bi")
MODE_LABELS = {"en": "English", "zh-HK": "廣東話 (繁體中文)", "bi": "Bilingual / 雙語"}
PLACEHOLDER = re.compile(r"(\{[a-zA-Z_][a-zA-Z0-9_]*\})")


def _load(lang: str) -> dict:
    with open(HERE / f"{lang}.json", encoding="utf-8") as fh:
        return json.load(fh)


CATALOGS: dict[str, dict] = {lang: _load(lang) for lang in LANGS}


def reload() -> None:
    for lang in LANGS:
        CATALOGS[lang] = _load(lang)


def lookup(lang: str, key: str, fun: int = 0) -> str:
    cat = CATALOGS.get(lang) or CATALOGS["en"]
    if fun >= 1:
        variants = cat.get("fun", {}).get(key)
        if isinstance(variants, dict):
            for level in range(fun, 0, -1):
                v = variants.get(str(level))
                if v:
                    return v
    return cat.get("strings", {}).get(key) or key


def _apply_vocab(text: str, vocab) -> str:
    if vocab is None:
        return text
    parts = PLACEHOLDER.split(text)
    return "".join(p if PLACEHOLDER.fullmatch(p) else vocab(p) for p in parts)


def _fill(text: str, args: dict, html: bool) -> str:
    if not args:
        return text

    def sub(m):
        name = m.group(1)[1:-1]
        if name not in args:
            return m.group(1)
        v = args[name]
        return str(escape(v)) if html else str(v)

    return PLACEHOLDER.sub(sub, text)


class Translator:
    """Bound per request: language mode, fun level and the wording filter."""

    def __init__(self, mode: str = "en", fun: int = 0, vocab=None):
        self.mode = mode if mode in MODES else "en"
        self.fun = max(0, min(3, int(fun)))
        self.vocab = vocab  # callable or None (None = ordinary wording)

    @property
    def html_lang(self) -> str:
        return "zh-HK" if self.mode == "zh-HK" else "en"

    def _one(self, lang: str, key: str, serious: bool) -> str:
        text = lookup(lang, key, 0 if serious else self.fun)
        if lang == "en":
            text = _apply_vocab(text, self.vocab)
        return text

    def plain(self, key: str, serious: bool = False, **args) -> str:
        """Plain text (attributes, titles, JS strings). Bilingual joins with ' / '."""
        if self.mode == "bi":
            en = _fill(self._one("en", key, serious), args, False)
            zh = _fill(self._one("zh-HK", key, serious), args, False)
            return en if en == zh else f"{en} / {zh}"
        return _fill(self._one(self.mode, key, serious), args, False)

    def html(self, key: str, serious: bool = False, **args):
        """Element content. Bilingual renders two lines."""
        if self.mode == "bi":
            en = _fill(str(escape(self._one("en", key, serious))), args, True)
            zh = _fill(str(escape(self._one("zh-HK", key, serious))), args, True)
            if en == zh:
                return Markup(en)
            return Markup(f'<span class="bi-en">{en}</span><span class="bi-zh" lang="zh-HK">{zh}</span>')
        return Markup(_fill(str(escape(self._one(self.mode, key, serious))), args, True))


def all_keys(lang: str = "en") -> set[str]:
    return set(CATALOGS[lang].get("strings", {}))
