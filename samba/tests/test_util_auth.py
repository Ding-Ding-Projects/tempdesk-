import datetime as dt
import re

from tempdesk_agent import util
from tempdesk_agent.auth import Lockout, RateLimiter, TokenSigner, keys_equal


def test_guest_username_rules():
    seen = set()
    for _ in range(500):
        u = util.guest_username("guest-")
        assert re.fullmatch(r"guest-[abcdefghjkmnpqrstuvwxyz23456789]{6}", u)
        seen.add(u)
    assert len(seen) > 490
    assert len(util.guest_username("guest-")) <= 20  # sAMAccountName limit


def test_guest_password_rules():
    for n in (12, 14, 30):
        for _ in range(200):
            pw = util.guest_password(n)
            assert len(pw) == n
            assert any(c in util.PW_UPPER for c in pw)
            assert any(c in util.PW_LOWER for c in pw)
            assert any(c in util.PW_DIGIT for c in pw)
            assert any(c in util.PW_SYMBOL for c in pw)
            assert util.password_is_complex(pw)
    assert len(util.guest_password(4)) == 12  # floor


def test_filetime_roundtrip():
    d = dt.datetime(2026, 11, 2, 20, 30, tzinfo=dt.timezone.utc)
    ft = util.to_filetime(d)
    assert ft == (int(d.timestamp()) + 11644473600) * 10_000_000 == 134381250000000000
    assert util.from_filetime(ft) == d
    assert util.from_filetime(0) is None
    assert util.from_filetime(util.NEVER_EXPIRES) is None
    assert util.iso(d) == "2026-11-02T20:30:00Z"


def test_dn_is_under():
    assert util.dn_is_under("CN=g,OU=Guests,OU=TempDesk,DC=a", "ou=guests, ou=tempdesk,dc=a")
    assert not util.dn_is_under("OU=Guests,OU=TempDesk,DC=a", "OU=Guests,OU=TempDesk,DC=a")
    assert not util.dn_is_under("CN=x,OU=NotGuests,OU=TempDesk,DC=a", "OU=Guests,OU=TempDesk,DC=a")


def test_script_name_validation():
    assert util.valid_script_name("setup.ps1") and util.valid_script_name("a-b_c.CMD")
    for bad in ("../x.ps1", "x.bat", "a b.ps1", "x" * 70 + ".ps1", "", "x.ps1\n"):
        assert not util.valid_script_name(bad)


def test_token_sign_verify_expiry_revoke(clock):
    s = TokenSigner(b"k" * 32, clock=clock)
    tok, exp = s.issue("alice", "Alice")
    assert exp == clock.t + 8 * 3600
    assert s.verify(tok)["sub"] == "alice"
    body, sig = tok.split(".")
    assert s.verify(body + "." + sig[:-2] + ("AA" if sig[-2:] != "AA" else "BB")) is None
    assert s.verify(tok + "x") is None and s.verify("") is None and s.verify("a.b.c") is None
    assert TokenSigner(b"z" * 32, clock=clock).verify(tok) is None
    clock.t += 8 * 3600 - 1
    assert s.verify(tok)
    clock.t += 1
    assert s.verify(tok) is None
    tok2, _ = s.issue("bob")
    assert s.revoke(tok2) and s.verify(tok2) is None


def test_keys_equal():
    assert keys_equal("abc", "abc")
    assert not keys_equal("abc", "abd") and not keys_equal(None, "x") and not keys_equal("", "")


def test_lockout_5_in_15_minutes(clock):
    lk = Lockout(clock=clock)
    for _ in range(4):
        lk.fail("Bob")
    assert not lk.locked("bob")
    lk.fail("bob")
    assert lk.locked("BOB")
    clock.t += 15 * 60
    assert not lk.locked("bob")
    lk.fail("bob")
    lk.success("bob")
    assert not lk.locked("bob")


def test_rate_limiter(clock):
    rl = RateLimiter(clock=clock)
    assert all(rl.allow("ip", 3, 3600) for _ in range(3))
    assert not rl.allow("ip", 3, 3600)
    assert rl.allow("other", 3, 3600)
    clock.t += 3600
    assert rl.allow("ip", 3, 3600)
