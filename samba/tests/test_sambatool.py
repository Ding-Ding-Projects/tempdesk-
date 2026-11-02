import sys

import pytest

from tempdesk_agent import sambatool as st


def test_allowlist_and_argv():
    argv = st.build_argv("user  setexpiry", ["guest-ab12cd", "--days=1"])
    assert argv == ["samba-tool", "user", "setexpiry", "guest-ab12cd", "--days=1"]
    with pytest.raises(st.SambaToolError):
        st.build_argv("domain provision", [])
    with pytest.raises(st.SambaToolError):
        st.build_argv("user", [])
    with pytest.raises(st.SambaToolError):
        st.build_argv("user list", "--full-dn")  # string instead of list


def test_shell_metacharacters_are_plain_argv():
    argv = st.build_argv("user show", ["x; rm -rf /", "$(id)"])
    assert argv[-2:] == ["x; rm -rf /", "$(id)"]


@pytest.mark.parametrize("arg", ["-H", "-Hldap://evil", "--URL=ldap://x", "-s", "--configfile=/tmp/x",
                                 "--option=x", "-Uadmin", "--tmpdir=/etc", "--password=x", "-d10"])
def test_forbidden_options(arg):
    with pytest.raises(st.SambaToolError):
        st.build_argv("user list", [arg])


def test_control_characters_rejected():
    with pytest.raises(st.SambaToolError):
        st.build_argv("user show", ["a\nb"])


def test_confirm_rule():
    for cmd, args in [("user delete", ["bob"]), ("group removemembers", ["g", "bob"]), ("gpo del", ["{x}"]),
                      ("dns delete", ["127.0.0.1", "z", "n", "A", "1.2.3.4"]), ("sites remove", ["s"])]:
        assert st.needs_confirm(cmd)
        with pytest.raises(st.SambaToolError):
            st.build_argv(cmd, args)
        with pytest.raises(st.SambaToolError):
            st.build_argv(cmd, args, confirm="yes")
        assert st.build_argv(cmd, args, confirm=cmd)[1:3] == cmd.split()[:2]
    assert not st.needs_confirm("user list") and not st.needs_confirm("user create")


def test_cred_args_only_for_network_families():
    assert st.build_argv("gpo listall", [], cred_args=["-A", "f"])[-2:] == ["-A", "f"]
    assert "-A" not in st.build_argv("user list", [], cred_args=["-A", "f"])


def test_catalog_shape():
    cat = st.catalog()
    names = [c["command"] for c in cat]
    assert "user list" in names and "schema attribute show" in names and "drs showrepl" in names
    for fam in ("user", "group", "computer", "ou", "contact", "dns", "gpo", "domain passwordsettings",
                "domain level", "fsmo", "dbcheck", "drs showrepl", "sites", "spn", "delegation"):
        assert any(n.startswith(fam) for n in names), fam


def test_run_caps_output_and_timeout():
    r = st.run([sys.executable, "-c", "import sys; sys.stdout.write('x' * (2 * 1024 * 1024))"])
    assert r["exitCode"] == 0 and r["stdout"].endswith("[output truncated at 1 MB]")
    assert len(r["stdout"]) < 1024 * 1024 + 100
    r = st.run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=1)
    assert r["exitCode"] == -1 and "timed out" in r["stderr"]
    assert st.run(["/nonexistent/samba-tool"])["exitCode"] == 127
