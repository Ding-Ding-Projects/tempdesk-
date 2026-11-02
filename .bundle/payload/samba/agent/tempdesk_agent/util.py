"""Small pure helpers: guest names, passwords, FILETIME conversion, ISO dates,
name validation."""

from __future__ import annotations

import datetime as dt
import re
import secrets
import string

USERNAME_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
USERNAME_SUFFIX_LEN = 6

PW_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
PW_LOWER = "abcdefghijkmnopqrstuvwxyz"
PW_DIGIT = "23456789"
PW_SYMBOL = "!#%+-=?@^_"

FILETIME_EPOCH = dt.datetime(1601, 1, 1, tzinfo=dt.timezone.utc)
NEVER_EXPIRES = 0x7FFFFFFFFFFFFFFF

UF_ACCOUNTDISABLE = 0x0002
UF_LOCKOUT = 0x0010
UF_PASSWD_CANT_CHANGE = 0x0040
UF_NORMAL_ACCOUNT = 0x0200
UF_DONT_EXPIRE_PASSWD = 0x10000

SCRIPT_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
WIFI_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
BACKUP_ID_RE = re.compile(r"^[A-Za-z0-9._{}-]{1,128}$")


def guest_username(prefix: str) -> str:
    return prefix + "".join(secrets.choice(USERNAME_ALPHABET) for _ in range(USERNAME_SUFFIX_LEN))


def guest_password(length: int = 14) -> str:
    """Random password with at least one upper, lower, digit and symbol
    (Windows complexity needs 3 of 4 categories; we always give all 4)."""
    length = max(12, min(int(length or 14), 128))
    pools = [PW_UPPER, PW_LOWER, PW_DIGIT, PW_SYMBOL]
    chars = [secrets.choice(p) for p in pools]
    allc = "".join(pools)
    chars += [secrets.choice(allc) for _ in range(length - len(chars))]
    # Fisher-Yates with secrets
    for i in range(len(chars) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        chars[i], chars[j] = chars[j], chars[i]
    return "".join(chars)


def password_is_complex(pw: str, sam: str = "", display: str = "") -> bool:
    if len(pw) < 7:
        return False
    cats = sum([
        any(c.isupper() for c in pw),
        any(c.islower() for c in pw),
        any(c.isdigit() for c in pw),
        any(not c.isalnum() for c in pw),
    ])
    if cats < 3:
        return False
    if sam and len(sam) >= 3 and sam.lower() in pw.lower():
        return False
    return True


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(d: dt.datetime | None) -> str | None:
    if d is None:
        return None
    return d.astimezone(dt.timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_filetime(d: dt.datetime) -> int:
    delta = d.astimezone(dt.timezone.utc) - FILETIME_EPOCH
    return (delta.days * 86400 + delta.seconds) * 10_000_000 + delta.microseconds * 10


def from_filetime(v) -> dt.datetime | None:
    """None for 0 / never expires values."""
    try:
        v = int(v)
    except (TypeError, ValueError):
        return None
    if v <= 0 or v >= NEVER_EXPIRES:
        return None
    return FILETIME_EPOCH + dt.timedelta(microseconds=v // 10)


def parse_generalized_time(s: str) -> dt.datetime | None:
    """LDAP GeneralizedTime like 20261102203000.0Z"""
    m = re.match(r"^(\d{14})", str(s))
    if not m:
        return None
    return dt.datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(tzinfo=dt.timezone.utc)


def valid_script_name(name: str) -> bool:
    return bool(SCRIPT_NAME_RE.match(name or "")) and name.lower().endswith((".ps1", ".cmd")) \
        and name not in (".", "..")


def valid_id(name: str, rx=WIFI_ID_RE) -> bool:
    return bool(rx.match(name or "")) and name not in (".", "..")


def dn_is_under(dn: str, base: str) -> bool:
    """Case insensitive check that dn is strictly inside base."""
    norm = lambda s: ",".join(p.strip().lower() for p in s.split(","))
    d, b = norm(dn), norm(base)
    return d.endswith("," + b) and d != b


def ldap_escape(value: str) -> str:
    out = []
    for c in value:
        if c in "\\*()\x00":
            out.append("\\%02x" % ord(c))
        else:
            out.append(c)
    return "".join(out)


def xml_escape(s: str) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&apos;"))


def html_escape(s) -> str:
    import html
    return html.escape(str(s), quote=True)


SAFE_SSID_CHARS = set(string.printable) - set("\r\n\t\x0b\x0c")
