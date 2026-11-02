import struct

import pytest

from tempdesk_agent import preg


def test_roundtrip_all_types():
    pol = preg.PolFile()
    pol.set_value(r"Software\Policies\Test", "S", "String", "héllo")
    pol.set_value(r"Software\Policies\Test", "E", "ExpandString", "%SystemRoot%\\x")
    pol.set_value(r"Software\Policies\Test", "D", "DWord", 4294967295)
    pol.set_value(r"Software\Policies\Test", "Q", "QWord", 2 ** 40)
    pol.set_value(r"Software\Policies\Test", "M", "MultiString", ["a", "b c"])
    pol.set_value(r"Software\Policies\Test", "B", "Binary", "deadbeef")
    data = pol.to_bytes()
    assert data[:4] == b"PReg" and struct.unpack("<I", data[4:8])[0] == 1
    back = preg.PolFile.from_bytes(data)
    assert back.to_bytes() == data
    vals = {e.value_name: e.decoded() for e in back.entries}
    assert vals == {"S": "héllo", "E": "%SystemRoot%\\x", "D": 4294967295, "Q": 2 ** 40,
                    "M": ["a", "b c"], "B": "deadbeef"}


def test_known_bytes_layout():
    pol = preg.PolFile([preg.PolEntry("K", "V", preg.REG_DWORD, struct.pack("<I", 1))])
    expected = (b"PReg\x01\x00\x00\x00" + "[K\x00;V\x00;".encode("utf-16-le") + b"\x04\x00\x00\x00"
                + ";".encode("utf-16-le") + b"\x04\x00\x00\x00" + ";".encode("utf-16-le")
                + b"\x01\x00\x00\x00" + "]".encode("utf-16-le"))
    assert pol.to_bytes() == expected


def test_empty_and_bad_files():
    assert preg.PolFile.from_bytes(b"").entries == []
    assert preg.PolFile.from_bytes(b"PReg\x01\x00\x00\x00").entries == []
    with pytest.raises(preg.PolError):
        preg.PolFile.from_bytes(b"XXXX\x01\x00\x00\x00")
    with pytest.raises(preg.PolError):
        preg.PolFile.from_bytes(b"PReg\x01\x00\x00\x00" + "[K".encode("utf-16-le"))


def test_set_replaces_case_insensitive_and_delete_markers():
    pol = preg.PolFile()
    pol.set_value("Software\\A", "X", "DWord", 1)
    pol.set_value("software\\a", "x", "DWord", 2)
    assert len(pol.entries) == 1 and pol.entries[0].decoded() == 2
    pol.mark_delete("Software\\A", "X")
    assert len(pol.entries) == 1 and pol.entries[0].value_name == "**del.X"
    assert pol.entries[0].is_delete_marker
    pol.set_value("Software\\A", "X", "DWord", 3)
    assert [e.value_name for e in pol.entries] == ["X"]


def test_under_and_remove_recursive():
    pol = preg.PolFile()
    pol.set_value("Software\\A", "1", "String", "a")
    pol.set_value("Software\\A\\B", "2", "String", "b")
    pol.set_value("Software\\AB", "3", "String", "c")
    assert len(pol.under("Software\\A")) == 2
    assert len(pol.under("Software\\A", recursive=False)) == 1
    assert pol.remove("Software\\A", recursive=True) == 2
    assert [e.key for e in pol.entries] == ["Software\\AB"]


def test_split_hive():
    assert preg.split_hive(r"HKLM\Software\X") == ("Machine", r"Software\X")
    assert preg.split_hive(r"HKEY_CURRENT_USER\Software") == ("User", "Software")
    with pytest.raises(preg.PolError):
        preg.split_hive(r"HKCR\x")


def test_negative_dword_wraps():
    assert preg.encode_value(preg.REG_DWORD, -1) == b"\xff\xff\xff\xff"
    with pytest.raises(preg.PolError):
        preg.encode_value(preg.REG_DWORD, 2 ** 33)
