"""Offline docs browser and changelog viewer.

Markdown files are bundled into the image (DOCS_DIR, default /app/bundled-docs,
and CHANGELOG.md beside it). Markdown is rendered with raw HTML escaped, so a
document cannot inject markup or script."""

from __future__ import annotations

import os
import re
from pathlib import Path

from markdown_it import MarkdownIt
from markupsafe import Markup

HERE = Path(__file__).parent
_md = MarkdownIt("commonmark", {"html": False, "linkify": False}).enable("table")
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}\.md$")


def docs_dir() -> Path:
    env = os.environ.get("DOCS_DIR")
    if env:
        return Path(env)
    for cand in (HERE.parent / "bundled-docs", HERE.parent.parent / "docs"):
        if cand.exists():
            return cand
    return HERE.parent / "bundled-docs"


def _safe_links(html: str) -> str:
    # Neutralise javascript: and other non-http links (markdown-it already
    # validates links, this is a second guard).
    return re.sub(r'href="(?!https?:|#|/|[A-Za-z0-9._-]+\.md)[^"]*"', 'href="#"', html)


def _title(text: str, fallback: str) -> str:
    for ln in text.splitlines():
        if ln.startswith("# "):
            return ln[2:].strip()
    return fallback


def docs_index(q: str = "") -> list[dict]:
    d = docs_dir()
    out = []
    for f in sorted(d.glob("*.md")) if d.exists() else []:
        if f.name.upper() == "CHANGELOG.MD":
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except OSError:
            continue
        hits = 0
        snippet = ""
        if q:
            low, ql = text.casefold(), q.casefold()
            hits = low.count(ql)
            if not hits:
                continue
            i = low.find(ql)
            snippet = text[max(0, i - 60): i + 100].replace("\n", " ")
        out.append({"name": f.name, "title": _title(text, f.stem), "hits": hits, "snippet": snippet})
    return out


def render_doc(name: str) -> dict | None:
    if not NAME_RE.fullmatch(name):
        return None
    f = docs_dir() / name
    try:
        text = f.read_text(encoding="utf-8")
    except OSError:
        return None
    return {"name": name, "title": _title(text, name), "html": Markup(_safe_links(_md.render(text)))}


def changelog_html():
    for cand in (docs_dir() / "CHANGELOG.md", docs_dir().parent / "CHANGELOG.md", HERE.parent / "CHANGELOG.md"):
        try:
            return Markup(_safe_links(_md.render(cand.read_text(encoding="utf-8"))))
        except OSError:
            continue
    return None
