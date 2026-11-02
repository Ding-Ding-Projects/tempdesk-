from tempdesk_agent import gpt

A = "{31B2F340-016D-11D2-945F-00C04FB984F9}"
B = "{6AC1786C-016F-11D2-945F-00C04FB984F9}"


def test_version_bump_math():
    assert gpt.bump_version(0, machine=True) == 1
    assert gpt.bump_version(0, user=True) == 65536
    v = (3 << 16) | 7
    assert gpt.split_version(v) == (3, 7)
    assert gpt.bump_version(v, machine=True) == (3 << 16) | 8
    assert gpt.bump_version(v, user=True) == (4 << 16) | 7
    assert gpt.bump_version(v, machine=True, user=True) == (4 << 16) | 8
    # 16 bit wrap skips 0
    assert gpt.split_version(gpt.bump_version(0xFFFF, machine=True)) == (0, 1)
    assert gpt.split_version(gpt.bump_version(0xFFFF0000, user=True)) == (1, 0)


def test_gpt_ini_version_rewrite():
    text = "[General]\r\nVersion=65537\r\ndisplayName=New Group Policy Object\r\n"
    assert gpt.read_gpt_ini_version(text) == 65537
    out = gpt.set_gpt_ini_version(text, 65538)
    assert out == "[General]\r\nVersion=65538\r\ndisplayName=New Group Policy Object\r\n"
    assert gpt.set_gpt_ini_version("", 5) == "[General]\r\nVersion=5\r\n"
    assert gpt.read_gpt_ini_version(gpt.set_gpt_ini_version("[General]\n", 9)) == 9


def test_cse_merge_sort_and_dedupe():
    s = ""
    s = gpt.merge_cse(s, gpt.SECURITY_CSE, gpt.SECURITY_TOOL)
    s = gpt.merge_cse(s, gpt.REGISTRY_CSE, gpt.REGISTRY_TOOL_MACHINE)
    assert s == (f"[{gpt.REGISTRY_CSE}{gpt.REGISTRY_TOOL_MACHINE}]"
                 f"[{gpt.SECURITY_CSE}{gpt.SECURITY_TOOL}]")
    # idempotent, and merges a second tool under the same CSE in sorted order
    assert gpt.merge_cse(s, gpt.REGISTRY_CSE, gpt.REGISTRY_TOOL_MACHINE) == s
    s2 = gpt.merge_cse(s, gpt.REGISTRY_CSE, gpt.REGISTRY_TOOL_USER)
    assert s2.startswith(f"[{gpt.REGISTRY_CSE}{gpt.REGISTRY_TOOL_MACHINE}{gpt.REGISTRY_TOOL_USER}]")
    # lower case input is normalised
    assert gpt.merge_cse(s.lower(), gpt.REGISTRY_CSE, gpt.REGISTRY_TOOL_MACHINE) == s
    assert gpt.remove_cse(s, gpt.SECURITY_CSE) == f"[{gpt.REGISTRY_CSE}{gpt.REGISTRY_TOOL_MACHINE}]"


def test_gplink_parse_and_order():
    s = (f"[LDAP://cn={A},cn=policies,cn=system,DC=lab,DC=example;0]"
         f"[LDAP://CN={B},CN=Policies,CN=System,DC=lab,DC=example;3]")
    parsed = gpt.parse_gplink(s)
    assert [p["options"] for p in parsed] == [0, 3]
    links = gpt.links_with_order(parsed)
    assert links[0]["guid"] == A and links[0]["order"] == 2 and links[0]["enabled"]
    assert links[1]["guid"] == B and links[1]["order"] == 1 and not links[1]["enabled"] and links[1]["enforced"]
    assert gpt.format_gplink(parsed) == s.replace("cn=policies", "cn=policies")  # roundtrip unchanged
    assert gpt.parse_gplink("") == [] and gpt.parse_gplink(" ") == []


def test_set_link_new_update_order_and_remove():
    dn_a = f"CN={A},CN=Policies,CN=System,DC=x"
    dn_b = f"CN={B},CN=Policies,CN=System,DC=x"
    links = gpt.set_link([], dn_a)
    links = gpt.set_link(links, dn_b)  # new link gets lowest precedence: prepended
    assert [l["guid"] for l in gpt.links_with_order(links)] == [B, A]
    assert gpt.links_with_order(links)[1]["order"] == 1  # A still first in precedence
    links = gpt.set_link(links, dn_b, order=1)
    o = {l["guid"]: l["order"] for l in gpt.links_with_order(links)}
    assert o == {B: 1, A: 2}
    links = gpt.set_link(links, dn_a, enabled=False, enforced=True)
    la = next(l for l in gpt.links_with_order(links) if l["guid"] == A)
    assert la["order"] == 2 and not la["enabled"] and la["enforced"]
    assert len(gpt.remove_link(links, A.lower())) == 1
