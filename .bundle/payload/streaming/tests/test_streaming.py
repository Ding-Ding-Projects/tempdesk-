import base64
import hashlib
import hmac
import json
import sys
import time
from pathlib import Path
from urllib.parse import unquote

import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tempdesk_streaming import catalog, guac_json, rdp_file  # noqa: E402
from tempdesk_streaming.catalog import App, AppValidationError  # noqa: E402

KEY = "4c0b569e4c96df157eee1b65dd0e4d41"  # example key from the Guacamole manual


# ---------------------------------------------------------------- reference decryptor
def reference_decrypt(b64: str, hex_key: str) -> dict:
    """Independent implementation of what guacamole-auth-json does on receipt."""
    key = bytes.fromhex(hex_key)
    raw = base64.b64decode(b64, validate=True)
    assert len(raw) % 16 == 0
    dec = Cipher(algorithms.AES(key), modes.CBC(b"\0" * 16)).decryptor()
    plain = dec.update(raw) + dec.finalize()
    unpad = padding.PKCS7(128).unpadder()
    plain = unpad.update(plain) + unpad.finalize()
    sig, body = plain[:32], plain[32:]
    if not hmac.compare_digest(sig, hmac.new(key, body, hashlib.sha256).digest()):
        raise ValueError("bad signature")
    doc = json.loads(body.decode("utf-8"))
    if "expires" in doc and int(doc["expires"]) < time.time() * 1000:
        raise ValueError("expired")
    return doc


def sample(**over):
    d = {"id": "notepad", "name": "Notepad", "host": "apphost.corp.example", "program": "||notepad"}
    d.update(over)
    return d


# ---------------------------------------------------------------- catalog
def test_valid_minimal_defaults():
    a = catalog.validate_app(sample())
    assert a.port == 3389 and a.rdpSecurity == "nla" and a.ignoreCert is False
    assert a.resizeMethod == "display-update" and a.enabled and a.groups == []
    assert a.alias == "notepad"


@pytest.mark.parametrize("field,value", [
    ("id", "Notepad"), ("id", "a" * 41), ("id", ""), ("id", "no_underscore"),
    ("program", "notepad"), ("program", "||"), ("program", "||bad alias"),
    ("port", 0), ("port", 70000), ("port", True), ("port", "3389"),
    ("host", "bad host"), ("host", ""), ("rdpSecurity", "none"),
    ("resizeMethod", "stretch"), ("ignoreCert", "yes"), ("groups", "TempDesk Guests"),
    ("groups", [""]), ("name", ""), ("name", "line\nbreak"), ("icon", "notepad.png"),
    ("icon", "data:text/html;base64,AAAA"), ("hostPath", "notepad.exe"), ("arguments", "a\r\nusername:s:x"),
])
def test_invalid_fields(field, value):
    with pytest.raises(AppValidationError) as e:
        catalog.validate_app(sample(**{field: value}))
    assert field in e.value.errors


def test_unknown_field_rejected():
    with pytest.raises(AppValidationError):
        catalog.validate_app(sample(password="x"))


def test_full_path_program_and_icons():
    assert catalog.validate_app(sample(program=r"C:\Windows\System32\notepad.exe")).alias is None
    assert catalog.validate_app(sample(program=r"%windir%\system32\mspaint.exe"))
    assert catalog.validate_app(sample(icon="\U0001F4DD")).icon
    assert catalog.validate_app(sample(hostPath=r"C:\Windows\System32\notepad.exe")).hostPath
    assert catalog.validate_app(sample(icon="data:image/png;base64,iVBORw0KGgo=")).icon


def test_duplicate_ids_rejected():
    with pytest.raises(AppValidationError) as e:
        catalog.validate_apps([sample(), sample()])
    assert e.value.index == 1


def test_settings_merge_keeps_other_keys():
    settings = {"orgName": "X", "guestGroup": "TempDesk Guests"}
    assert catalog.load_apps(settings) == []
    s2 = catalog.upsert_app(settings, sample())
    assert settings == {"orgName": "X", "guestGroup": "TempDesk Guests"}  # not mutated
    assert s2["orgName"] == "X" and s2["apps"][0]["id"] == "notepad"
    s3 = catalog.upsert_app(s2, sample(name="Notepad 2"))
    assert len(s3["apps"]) == 1 and s3["apps"][0]["name"] == "Notepad 2"
    s4 = catalog.upsert_app(s3, sample(id="paint", program="||mspaint"))
    assert [a["id"] for a in s4["apps"]] == ["notepad", "paint"]
    assert catalog.get_app(s4, "paint").program == "||mspaint"
    s5 = catalog.remove_app(s4, "notepad")
    assert [a["id"] for a in s5["apps"]] == ["paint"]
    # round trip through JSON like the agent would store it
    assert catalog.load_apps(json.loads(json.dumps(s5)))[0].id == "paint"


def test_group_filter():
    settings = {"apps": [sample(), sample(id="word", program="||winword", groups=["Staff"]),
                         sample(id="off", enabled=False)]}
    assert [a.id for a in catalog.apps_for_user(settings, ["TempDesk Guests"])] == ["notepad"]
    assert [a.id for a in catalog.apps_for_user(settings, ["staff"])] == ["notepad", "word"]


# ---------------------------------------------------------------- guacamole json
def test_reference_decryptor_accepts_manual_vector():
    vec = (Path(__file__).parent / "guac_doc_vector.b64").read_text()
    key = bytes.fromhex(KEY)
    raw = base64.b64decode(vec)
    dec = Cipher(algorithms.AES(key), modes.CBC(b"\0" * 16)).decryptor()
    plain = dec.update(raw) + dec.finalize()
    unpad = padding.PKCS7(128).unpadder()
    plain = unpad.update(plain) + unpad.finalize()
    assert hmac.new(key, plain[32:], hashlib.sha256).digest() == plain[:32]
    assert json.loads(plain[32:])["username"] == "test"


def test_round_trip_and_parameters():
    app = catalog.validate_app(sample(arguments="C:\\x.txt", workingDir="C:\\Users", disablePaste=True))
    payload, name = guac_json.build_app_payload(
        app, username="guest-ab12", password="S3cret!", domain="CORP", hex_key=KEY)
    doc = reference_decrypt(payload, KEY)
    assert doc["username"] == "guest-ab12" and name == "Notepad"
    conn = doc["connections"]["Notepad"]
    assert conn["protocol"] == "rdp"
    p = conn["parameters"]
    assert all(isinstance(v, str) for v in p.values())
    assert p["hostname"] == "apphost.corp.example" and p["port"] == "3389"
    assert p["password"] == "S3cret!" and p["domain"] == "CORP"
    assert p["remote-app"] == "||notepad" and p["remote-app-args"] == "C:\\x.txt"
    assert p["remote-app-dir"] == "C:\\Users" and p["security"] == "nla"
    assert p["ignore-cert"] == "false" and p["enable-drive"] == "false"
    assert p["enable-printing"] == "false" and p["enable-wallpaper"] == "false"
    assert p["disable-audio"] == "false" and p["resize-method"] == "display-update"
    assert p["disable-copy"] == "false" and p["disable-paste"] == "true"


def test_expiry_default_two_minutes_and_expired_rejected():
    now = 1_800_000_000.0
    doc = guac_json.build_auth_json("u", {"c": {"protocol": "rdp", "parameters": {}}}, now=now)
    assert doc["expires"] == int((now + 120) * 1000)
    old = guac_json.encrypt_auth_json(
        guac_json.build_auth_json("u", {"c": {"protocol": "rdp", "parameters": {}}}, now=time.time() - 600), KEY)
    with pytest.raises(ValueError, match="expired"):
        reference_decrypt(old, KEY)
    with pytest.raises(ValueError):
        guac_json.build_auth_json("u", {"c": {"protocol": "rdp", "parameters": {}}}, lifetime_seconds=0)


def test_wrong_key_fails_and_bad_key_rejected():
    payload, _ = guac_json.build_app_payload(
        catalog.validate_app(sample()), username="u", password="p", domain="", hex_key=KEY)
    with pytest.raises(ValueError):
        reference_decrypt(payload, "00" * 16)
    for bad in ("abc", "zz" * 16, "00" * 17):
        with pytest.raises(ValueError):
            guac_json.parse_key(bad)


def test_disabled_app_refused():
    with pytest.raises(ValueError):
        guac_json.build_app_payload(catalog.validate_app(sample(enabled=False)),
                                    username="u", password="p", domain="", hex_key=KEY)


def test_client_identifier_format():
    # Known value: what Guacamole's own web app produces for connection "Notepad" in data source json
    assert guac_json.client_identifier("Notepad") == base64.b64encode(b"Notepad\0c\0json").decode()
    assert guac_json.client_identifier("Notepad") == "Tm90ZXBhZABjAGpzb24="
    assert base64.b64decode(guac_json.client_identifier("Café")) == "Café\0c\0json".encode()


def test_tokens_request_and_client_url():
    url, form = guac_json.tokens_request("https://apps.example/", "a+b/c=")
    assert url == "https://apps.example/api/tokens" and form == {"data": "a+b/c="}
    u = guac_json.client_url("https://apps.example/", "Notepad", "TOK+1")
    assert u.startswith("https://apps.example/#/client/")
    ident = unquote(u.split("/#/client/")[1].split("?")[0])
    assert base64.b64decode(ident) == b"Notepad\0c\0json"
    assert u.endswith("?token=TOK%2B1")


# ---------------------------------------------------------------- rdp file
def test_rdp_file_contents_and_no_password():
    app = catalog.validate_app(sample(arguments="/A", disableCopy=True, disablePaste=True))
    data = rdp_file.rdp_bytes(app, username="guest-ab12", domain="CORP", gateway_host="gw.example")
    assert data.startswith(b"\xff\xfe")
    text = data[2:].decode("utf-16-le")
    lines = text.split("\r\n")
    for expected in [
        "full address:s:apphost.corp.example", "remoteapplicationmode:i:1",
        "remoteapplicationprogram:s:||notepad", "remoteapplicationname:s:Notepad",
        "remoteapplicationcmdline:s:/A", "alternate shell:s:rdpinit.exe",
        "username:s:CORP\\guest-ab12", "prompt for credentials on client:i:1",
        "authentication level:i:2", "gatewayhostname:s:gw.example",
        "disableremoteappcapscheck:i:1", "drivestoredirect:s:", "redirectclipboard:i:0",
    ]:
        assert expected in lines
    assert "password" not in text.lower()


def test_rdp_port_and_no_gateway():
    text = rdp_file.rdp_text(catalog.validate_app(sample(port=3390)))
    assert "full address:s:apphost.corp.example:3390" in text
    assert "gatewayhostname" not in text and "username:s:" not in text
    assert "redirectclipboard:i:1" in text


def test_rdp_filename_and_disposition():
    app = catalog.validate_app(sample(name="Éditeur \"x\""))
    assert rdp_file.rdp_filename(app) == "notepad.rdp"
    cd = rdp_file.content_disposition(app)
    assert cd.startswith('attachment; filename="Editeur x.rdp"')
    assert "filename*=UTF-8''%C3%89diteur%20%22x%22.rdp" in cd
