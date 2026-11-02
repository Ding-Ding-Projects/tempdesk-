"""Validation for the TempDesk settings document (server/config/settings.default.json)."""

from __future__ import annotations

import re
from typing import Any

DN_RE = re.compile(r"^(?:(?:OU|CN|DC)=(?:[^,\\]|\\.)+)(?:,(?:OU|CN|DC)=(?:[^,\\]|\\.)+)*$", re.IGNORECASE)
GROUP_RE = re.compile(r'^[^"/\\\[\]:;|=,+*?<>@]{1,64}$')
PREFIX_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,11}$")
CHOICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,16}$")
MAX_MINUTES = 525600  # one year

# name: (kind, label, help, extra)
FIELDS: list[tuple[str, str, str, str, dict]] = [
    ("orgName", "text", "Organization name", "Shown at the top of both portals.", {"max": 100}),
    ("welcomeText", "textarea", "Welcome text", "Shown on the guest portal home page.", {"max": 1000}),
    ("usernamePrefix", "prefix", "Username prefix", "Start of every guest username. Letters, digits, dot, dash or underscore, up to 12 characters.", {}),
    ("guestOu", "dn", "Guest OU", "Where guest accounts are created, relative to the domain, for example OU=Guests,OU=TempDesk.", {}),
    ("guestGroup", "group", "Guest group", "Every guest account is added to this group.", {}),
    ("adminGroup", "group", "Admin group", "Members may sign in to the Admin console.", {}),
    ("guestGpoName", "gpo", "Guest user policy name", "Group Policy object applied to guest users.", {}),
    ("computerGpoName", "gpo", "Guest computers policy name", "Group Policy object applied to guest PCs.", {}),
    ("computersOu", "dn", "Computers OU", "Where guest PCs live, relative to the domain.", {}),
    ("expiryChoices", "choices", "Expiry choices", "Options guests can pick. Minutes 0 means permanent.", {}),
    ("allowPermanent", "bool", "Allow permanent guest accounts", "When off, the permanent choice is hidden from guests.", {}),
    ("allowSelfDelete", "bool", "Allow guests to delete their own sign-in", "Shows the Delete my sign-in page on the guest portal.", {}),
    ("passwordLength", "int", "Password length", "Length of generated guest passwords.", {"min": 8, "max": 128}),
    ("guestCreatePerHour", "int", "Creates per hour per address", "Agent side limit for each client address.", {"min": 1, "max": 10000}),
    ("guestMaxActive", "int", "Maximum active guests", "Guest creation stops at this many accounts.", {"min": 1, "max": 100000}),
    ("deleteProfileAfterMinutes", "int", "Delete PC profile after (minutes)", "0 removes the profile at the next cleanup run.", {"min": 0, "max": MAX_MINUTES}),
    ("logoffWarningMinutes", "int", "Sign-out warning (minutes)", "Warn signed-in guests this long before expiry.", {"min": 0, "max": 1440}),
    ("reaperIntervalMinutes", "int", "Cleanup interval (minutes)", "How often the agent removes expired accounts.", {"min": 1, "max": 1440}),
]
FIELD_NAMES = [f[0] for f in FIELDS]


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"-?\d{1,9}", value.strip()):
        return int(value.strip())
    return None


def validate_settings(doc: dict) -> tuple[dict, dict[str, str]]:
    """Return (clean document, errors by field). Unknown keys are kept as is."""
    errors: dict[str, str] = {}
    clean = dict(doc)
    for name, kind, label, _help, extra in FIELDS:
        v = doc.get(name)
        if kind in ("text", "textarea", "gpo"):
            v = "" if v is None else str(v).strip()
            mx = extra.get("max", 255)
            if not v:
                errors[name] = f"{label} is required."
            elif len(v) > mx:
                errors[name] = f"{label} must be at most {mx} characters."
            elif kind != "textarea" and any(ord(c) < 32 for c in v):
                errors[name] = f"{label} must not contain control characters."
            clean[name] = v
        elif kind == "prefix":
            v = "" if v is None else str(v).strip()
            if not PREFIX_RE.fullmatch(v):
                errors[name] = "Use 1 to 12 letters, digits, dots, dashes or underscores, starting with a letter or digit."
            clean[name] = v
        elif kind == "dn":
            v = "" if v is None else str(v).strip()
            if not DN_RE.fullmatch(v):
                errors[name] = "Enter a distinguished name such as OU=Guests,OU=TempDesk."
            clean[name] = v
        elif kind == "group":
            v = "" if v is None else str(v).strip()
            if not GROUP_RE.fullmatch(v):
                errors[name] = "Use up to 64 characters without \" / \\ [ ] : ; | = , + * ? < > @."
            clean[name] = v
        elif kind == "bool":
            if isinstance(v, str):
                v = v.lower() in ("1", "true", "on", "yes")
            clean[name] = bool(v)
        elif kind == "int":
            n = _int(v)
            if n is None:
                errors[name] = f"{label} must be a whole number."
            elif not extra["min"] <= n <= extra["max"]:
                errors[name] = f"{label} must be between {extra['min']} and {extra['max']}."
            clean[name] = n if n is not None else v
        elif kind == "choices":
            out, problem = [], None
            if not isinstance(v, list) or not v:
                problem = "Add at least one expiry choice."
            else:
                seen = set()
                for i, c in enumerate(v, start=1):
                    if not isinstance(c, dict):
                        problem = f"Choice {i} is not valid."
                        break
                    cid = str(c.get("id", "")).strip()
                    lab = str(c.get("label", "")).strip()
                    mins = _int(c.get("minutes"))
                    if not CHOICE_ID_RE.fullmatch(cid):
                        problem = f"Choice {i}: the id must be 1 to 16 letters, digits, dashes or underscores."
                    elif cid in seen:
                        problem = f"Choice {i}: the id {cid} is used twice."
                    elif not lab or len(lab) > 60:
                        problem = f"Choice {i}: the label must be 1 to 60 characters."
                    elif mins is None or not 0 <= mins <= MAX_MINUTES:
                        problem = f"Choice {i}: minutes must be between 0 and {MAX_MINUTES}."
                    if problem:
                        break
                    seen.add(cid)
                    out.append({"id": cid, "label": lab, "minutes": mins})
                if not problem and len(out) > 20:
                    problem = "Use at most 20 expiry choices."
            if problem:
                errors[name] = problem
            clean[name] = out if not problem else v
    return clean, errors


def from_form(form, current: dict) -> dict:
    """Build a settings document from submitted form fields."""
    doc = dict(current)
    for name, kind, *_ in FIELDS:
        if kind == "bool":
            doc[name] = form.get(name) in ("on", "true", "1")
        elif kind == "choices":
            ids = form.getlist("exp_id")
            labels = form.getlist("exp_label")
            mins = form.getlist("exp_minutes")
            rows = []
            for cid, lab, m in zip(ids, labels, mins):
                if not (cid.strip() or lab.strip() or m.strip()):
                    continue
                rows.append({"id": cid.strip(), "label": lab.strip(), "minutes": m.strip()})
            doc[name] = rows
        else:
            doc[name] = form.get(name, "")
    return doc
