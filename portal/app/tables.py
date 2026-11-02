"""Server-side list handling shared by every table: search, sort and export."""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import urlencode

from fastapi import Request
from fastapi.responses import Response


def cell(row: Any, key: str) -> Any:
    cur = row
    for part in key.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    if isinstance(cur, list) and len(cur) == 1 and key.startswith("attributes."):
        return cur[0]
    return cur


def text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list):
        return "; ".join(text(v) for v in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _csv_safe(s: str) -> str:
    # Stop spreadsheet formula injection.
    if s and s[0] in "=+-@\t\r":
        return "'" + s
    return s


@dataclass
class TableView:
    id: str
    rows: list
    columns: list  # [(key, label)]
    q: str
    sort: str
    dir: str
    total: int
    key: str | None
    params: dict = field(default_factory=dict)
    path: str = ""

    def url(self, **changes) -> str:
        p = {k: v for k, v in self.params.items() if k not in ("export",)}
        p.update({k: v for k, v in changes.items()})
        p = {k: v for k, v in p.items() if v not in (None, "")}
        return self.path + ("?" + urlencode(p) if p else "")

    def sort_url(self, key: str) -> str:
        d = "desc" if self.sort == key and self.dir == "asc" else "asc"
        return self.url(sort=key, dir=d)

    def aria_sort(self, key: str) -> str:
        if self.sort != key:
            return "none"
        return "ascending" if self.dir == "asc" else "descending"

    def hidden_params(self) -> list[tuple[str, str]]:
        return [(k, v) for k, v in self.params.items() if k not in ("q", "export", "sort", "dir")]


def _sort_key(v: Any):
    if v is None or v == "":
        return (2, "")
    if isinstance(v, bool):
        return (0, int(v))
    if isinstance(v, (int, float)):
        return (0, v)
    s = text(v)
    try:
        return (0, float(s))
    except ValueError:
        return (1, s.casefold())


def table(
    request: Request,
    rows: list,
    columns: list,
    *,
    id: str = "list",
    key: str | None = None,
    default_sort: str | None = None,
    filename: str = "export",
    export_filter: Callable[[dict], dict] | None = None,
) -> TableView | Response:
    qp = request.query_params
    q = (qp.get("q") or "").strip()
    keys = [c[0] for c in columns]
    sort = qp.get("sort") or default_sort or (keys[0] if keys else "")
    if sort not in keys:
        sort = keys[0] if keys else ""
    direction = "desc" if qp.get("dir") == "desc" else "asc"
    rows = list(rows or [])
    total = len(rows)
    if q:
        needle = q.casefold()
        rows = [r for r in rows if needle in " ".join(text(cell(r, k)) for k in keys).casefold()
                or (key and needle in text(cell(r, key)).casefold())]
    if sort:
        rows.sort(key=lambda r: _sort_key(cell(r, sort)), reverse=direction == "desc")
    export = qp.get("export")
    if export in ("csv", "json"):
        data = [export_filter(r) if export_filter else r for r in rows]
        safe_name = "".join(c for c in filename if c.isalnum() or c in "-_") or "export"
        if export == "json":
            body = json.dumps(data, ensure_ascii=False, indent=2, default=str)
            return Response(body, media_type="application/json",
                            headers={"Content-Disposition": f'attachment; filename="{safe_name}.json"'})
        buf = io.StringIO()
        w = csv.writer(buf)
        cols = ([(key, key)] if key and key not in keys else []) + list(columns)
        w.writerow([c[1] for c in cols])
        for r in rows:
            w.writerow([_csv_safe(text(cell(r, c[0]))) for c in cols])
        return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"'})
    return TableView(id=id, rows=rows, columns=columns, q=q, sort=sort, dir=direction, total=total,
                     key=key, params=dict(qp), path=request.url.path)
