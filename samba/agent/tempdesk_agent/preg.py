"""Reader and writer for Group Policy Registry.pol files (PReg format).

File layout: the 4 byte signature b"PReg", a little endian uint32 version (1),
then a sequence of entries. Each entry is, in UTF-16LE:

    [key;valueName;type;size;data]

where "[", ";" and "]" are UTF-16LE characters, key and valueName are
NUL terminated UTF-16LE strings, type and size are little endian uint32
values and data is `size` raw bytes.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field

SIGNATURE = b"PReg"
VERSION = 1

REG_NONE = 0
REG_SZ = 1
REG_EXPAND_SZ = 2
REG_BINARY = 3
REG_DWORD = 4
REG_DWORD_BIG_ENDIAN = 5
REG_MULTI_SZ = 7
REG_QWORD = 11

TYPE_NAMES = {
    REG_SZ: "String",
    REG_EXPAND_SZ: "ExpandString",
    REG_BINARY: "Binary",
    REG_DWORD: "DWord",
    REG_MULTI_SZ: "MultiString",
    REG_QWORD: "QWord",
    REG_NONE: "None",
}
NAME_TYPES = {v.lower(): k for k, v in TYPE_NAMES.items()}

_LB = "[".encode("utf-16-le")
_RB = "]".encode("utf-16-le")
_SEMI = ";".encode("utf-16-le")
_NUL = "\x00".encode("utf-16-le")


class PolError(ValueError):
    pass


@dataclass
class PolEntry:
    key: str
    value_name: str
    type: int
    data: bytes = b""

    # Convenience accessors -------------------------------------------------
    @property
    def is_delete_marker(self) -> bool:
        n = self.value_name.lower()
        return n.startswith("**del.") or n.startswith("**delvals.")

    def decoded(self):
        return decode_value(self.type, self.data)


@dataclass
class PolFile:
    entries: list[PolEntry] = field(default_factory=list)

    # -- lookup ------------------------------------------------------------
    def find(self, key: str, value_name: str) -> PolEntry | None:
        k, v = key.lower(), value_name.lower()
        for e in self.entries:
            if e.key.lower() == k and e.value_name.lower() == v:
                return e
        return None

    def under(self, key: str, recursive: bool = True) -> list[PolEntry]:
        k = key.lower().rstrip("\\")
        out = []
        for e in self.entries:
            ek = e.key.lower()
            if ek == k or (recursive and (k == "" or ek.startswith(k + "\\"))):
                out.append(e)
        return out

    # -- mutation ----------------------------------------------------------
    def remove(self, key: str, value_name: str | None = None, recursive: bool = False) -> int:
        """Remove entries. value_name None removes every value of the key
        (and subkeys when recursive). Returns the number removed."""
        k = key.lower().rstrip("\\")
        before = len(self.entries)

        def match(e: PolEntry) -> bool:
            ek = e.key.lower()
            key_hit = ek == k or (recursive and ek.startswith(k + "\\"))
            if not key_hit:
                return False
            if value_name is None:
                return True
            vn = e.value_name.lower()
            t = value_name.lower()
            return vn == t or vn == "**del." + t

        self.entries = [e for e in self.entries if not match(e)]
        return before - len(self.entries)

    def set(self, key: str, value_name: str, type_: int, data: bytes) -> None:
        """Set a value, replacing an existing entry or delete marker for it."""
        self.remove(key, value_name)
        self.entries.append(PolEntry(key, value_name, type_, data))

    def set_value(self, key: str, value_name: str, type_name: str, value) -> None:
        t = type_from_name(type_name)
        self.set(key, value_name, t, encode_value(t, value))

    def mark_delete(self, key: str, value_name: str) -> None:
        self.remove(key, value_name)
        self.entries.append(PolEntry(key, "**del." + value_name, REG_SZ, encode_value(REG_SZ, " ")))

    def mark_delvals(self, key: str) -> None:
        self.entries = [e for e in self.entries
                        if not (e.key.lower() == key.lower() and e.value_name.lower() == "**delvals.")]
        self.entries.append(PolEntry(key, "**delvals.", REG_SZ, encode_value(REG_SZ, " ")))

    # -- serialization -----------------------------------------------------
    def to_bytes(self) -> bytes:
        out = bytearray(SIGNATURE + struct.pack("<I", VERSION))
        for e in self.entries:
            out += _LB
            out += e.key.encode("utf-16-le") + _NUL
            out += _SEMI
            out += e.value_name.encode("utf-16-le") + _NUL
            out += _SEMI
            out += struct.pack("<I", e.type)
            out += _SEMI
            out += struct.pack("<I", len(e.data))
            out += _SEMI
            out += e.data
            out += _RB
        return bytes(out)

    @classmethod
    def from_bytes(cls, buf: bytes) -> "PolFile":
        if not buf:
            return cls()
        if len(buf) < 8 or buf[:4] != SIGNATURE:
            raise PolError("not a Registry.pol file (bad signature)")
        (ver,) = struct.unpack_from("<I", buf, 4)
        if ver != VERSION:
            raise PolError(f"unsupported Registry.pol version {ver}")
        pos = 8
        entries = []
        n = len(buf)

        def read_str(p: int) -> tuple[str, int]:
            # NUL terminated UTF-16LE string, aligned to 2 bytes
            end = p
            while True:
                if end + 2 > n:
                    raise PolError("truncated string")
                if buf[end:end + 2] == _NUL:
                    break
                end += 2
            return buf[p:end].decode("utf-16-le"), end + 2

        def expect(p: int, tok: bytes) -> int:
            if buf[p:p + 2] != tok:
                raise PolError(f"expected {tok.decode('utf-16-le')!r} at offset {p}")
            return p + 2

        while pos < n:
            # tolerate trailing padding
            if n - pos < 2:
                break
            pos = expect(pos, _LB)
            key, pos = read_str(pos)
            pos = expect(pos, _SEMI)
            vname, pos = read_str(pos)
            pos = expect(pos, _SEMI)
            if pos + 4 > n:
                raise PolError("truncated type")
            (typ,) = struct.unpack_from("<I", buf, pos)
            pos = expect(pos + 4, _SEMI)
            if pos + 4 > n:
                raise PolError("truncated size")
            (size,) = struct.unpack_from("<I", buf, pos)
            pos = expect(pos + 4, _SEMI)
            if pos + size > n:
                raise PolError("truncated data")
            data = buf[pos:pos + size]
            pos = expect(pos + size, _RB)
            entries.append(PolEntry(key, vname, typ, bytes(data)))
        return cls(entries)

    @classmethod
    def load(cls, path: str) -> "PolFile":
        try:
            with open(path, "rb") as f:
                return cls.from_bytes(f.read())
        except FileNotFoundError:
            return cls()


def type_from_name(name: str) -> int:
    t = NAME_TYPES.get(str(name).lower())
    if t is None or t == REG_NONE:
        raise PolError(f"unknown registry type {name!r}")
    return t


def encode_value(t: int, value) -> bytes:
    if t in (REG_SZ, REG_EXPAND_SZ):
        return (str(value) + "\x00").encode("utf-16-le")
    if t == REG_MULTI_SZ:
        if isinstance(value, str):
            items = value.split("\n") if value else []
        else:
            items = [str(v) for v in (value or [])]
        return ("".join(i + "\x00" for i in items) + "\x00").encode("utf-16-le")
    if t == REG_DWORD:
        v = int(value)
        if not 0 <= v <= 0xFFFFFFFF:
            if -0x80000000 <= v < 0:
                v &= 0xFFFFFFFF
            else:
                raise PolError("DWord out of range")
        return struct.pack("<I", v)
    if t == REG_QWORD:
        v = int(value)
        if not 0 <= v <= 0xFFFFFFFFFFFFFFFF:
            if -(1 << 63) <= v < 0:
                v &= 0xFFFFFFFFFFFFFFFF
            else:
                raise PolError("QWord out of range")
        return struct.pack("<Q", v)
    if t == REG_BINARY:
        if isinstance(value, (bytes, bytearray)):
            return bytes(value)
        if isinstance(value, list):
            return bytes(int(b) for b in value)
        s = str(value).replace(" ", "").replace(",", "")
        if s.startswith("b64:"):
            import base64
            return base64.b64decode(s[4:])
        return bytes.fromhex(s)
    if t == REG_NONE:
        return b""
    raise PolError(f"cannot encode registry type {t}")


def decode_value(t: int, data: bytes):
    if t in (REG_SZ, REG_EXPAND_SZ):
        s = data.decode("utf-16-le", errors="replace")
        return s.split("\x00", 1)[0]
    if t == REG_MULTI_SZ:
        s = data.decode("utf-16-le", errors="replace")
        parts = s.split("\x00")
        while parts and parts[-1] == "":
            parts.pop()
        return parts
    if t == REG_DWORD and len(data) >= 4:
        return struct.unpack_from("<I", data)[0]
    if t == REG_DWORD_BIG_ENDIAN and len(data) >= 4:
        return struct.unpack_from(">I", data)[0]
    if t == REG_QWORD and len(data) >= 8:
        return struct.unpack_from("<Q", data)[0]
    return data.hex()


def split_hive(key: str) -> tuple[str, str]:
    """Split "HKLM\\Software\\X" into ("Machine", "Software\\X").

    Returns the GPO side ("Machine" or "User") and the key path relative to
    the hive, as stored in Registry.pol."""
    k = key.strip().replace("/", "\\")
    head, _, rest = k.partition("\\")
    h = head.upper().rstrip(":")
    if h in ("HKLM", "HKEY_LOCAL_MACHINE"):
        return "Machine", rest.strip("\\")
    if h in ("HKCU", "HKEY_CURRENT_USER"):
        return "User", rest.strip("\\")
    raise PolError("key must start with HKLM\\ or HKCU\\")


def join_hive(side: str, key: str) -> str:
    return ("HKLM\\" if side == "Machine" else "HKCU\\") + key
