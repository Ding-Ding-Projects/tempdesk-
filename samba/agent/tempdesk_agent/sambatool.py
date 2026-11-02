"""Allowlisted samba-tool runner. Commands run as argv lists with no shell,
a 60 second timeout and output capped at 1 MB per stream."""

from __future__ import annotations

import subprocess

TIMEOUT = 60
OUTPUT_CAP = 1024 * 1024

# Per family: subcommands with optional argument help. Each arg entry is
# (name, flag, type, help). flag "" means positional.
_P = lambda name, help_, type_="string": {"name": name, "flag": "", "type": type_, "help": help_}
_F = lambda name, flag, help_, type_="string": {"name": name, "flag": flag, "type": type_, "help": help_}

COMMANDS: dict[str, list[dict]] = {
    # user
    "user list": [_F("full-dn", "--full-dn", "Show full DNs", "switch"),
                  _F("base-dn", "--base-dn=", "Base DN to list from")],
    "user show": [_P("username", "sAMAccountName"), _F("attributes", "--attributes=", "Comma separated attributes")],
    "user create": [_P("username", "New sAMAccountName"), _P("password", "Initial password"),
                    _F("given-name", "--given-name=", "First name"), _F("surname", "--surname=", "Last name"),
                    _F("userou", "--userou=", "OU relative to the domain, for example OU=Staff"),
                    _F("must-change-at-next-login", "--must-change-at-next-login", "Force change", "switch")],
    "user delete": [_P("username", "sAMAccountName")],
    "user enable": [_P("username", "sAMAccountName")],
    "user disable": [_P("username", "sAMAccountName")],
    "user setexpiry": [_P("username", "sAMAccountName"), _F("days", "--days=", "Days from now", "int"),
                       _F("noexpiry", "--noexpiry", "Never expire", "switch")],
    "user setpassword": [_P("username", "sAMAccountName"), _F("newpassword", "--newpassword=", "New password"),
                         _F("must-change-at-next-login", "--must-change-at-next-login", "Force change", "switch")],
    "user getgroups": [_P("username", "sAMAccountName")],
    "user move": [_P("username", "sAMAccountName"), _P("new_parent_dn", "Target container DN")],
    "user rename": [_P("username", "sAMAccountName"), _F("surname", "--surname=", "Last name"),
                    _F("given-name", "--given-name=", "First name")],
    "user unlock": [_P("username", "sAMAccountName")],
    "user setprimarygroup": [_P("username", "sAMAccountName"), _P("primarygroupname", "Group name")],
    # group
    "group list": [_F("verbose", "--verbose", "Verbose", "switch")],
    "group show": [_P("groupname", "Group name")],
    "group add": [_P("groupname", "Group name"), _F("groupou", "--groupou=", "OU relative to the domain"),
                  _F("group-scope", "--group-scope=", "Domain|Global|Universal"),
                  _F("group-type", "--group-type=", "Security|Distribution"),
                  _F("description", "--description=", "Description")],
    "group delete": [_P("groupname", "Group name")],
    "group addmembers": [_P("groupname", "Group name"), _P("members", "Comma separated members")],
    "group removemembers": [_P("groupname", "Group name"), _P("members", "Comma separated members")],
    "group listmembers": [_P("groupname", "Group name")],
    "group move": [_P("groupname", "Group name"), _P("new_parent_dn", "Target container DN")],
    "group rename": [_P("groupname", "Group name"), _F("samaccountname", "--samaccountname=", "New name")],
    # computer
    "computer list": [],
    "computer show": [_P("computername", "Computer name")],
    "computer create": [_P("computername", "Computer name"), _F("computerou", "--computerou=", "OU relative to the domain")],
    "computer delete": [_P("computername", "Computer name")],
    "computer move": [_P("computername", "Computer name"), _P("new_ou_dn", "Target container DN")],
    # ou
    "ou list": [],
    "ou create": [_P("ou_dn", "OU DN"), _F("description", "--description=", "Description")],
    "ou delete": [_P("ou_dn", "OU DN"), _F("force-subtree-delete", "--force-subtree-delete", "Delete children", "switch")],
    "ou move": [_P("old_ou_dn", "OU DN"), _P("new_parent_dn", "Target DN")],
    "ou rename": [_P("old_ou_dn", "OU DN"), _P("new_ou_dn", "New OU DN")],
    "ou listobjects": [_P("ou_dn", "OU DN")],
    # contact
    "contact list": [],
    "contact show": [_P("contactname", "Contact name")],
    "contact create": [_P("fullcontactname", "Full name"), _F("ou", "--ou=", "OU relative to the domain"),
                       _F("mail-address", "--mail-address=", "Email")],
    "contact delete": [_P("contactname", "Contact name")],
    "contact move": [_P("contactname", "Contact name"), _P("new_parent_dn", "Target DN")],
    # dns
    "dns serverinfo": [_P("server", "DNS server (127.0.0.1)")],
    "dns zonelist": [_P("server", "DNS server (127.0.0.1)")],
    "dns zoneinfo": [_P("server", "DNS server"), _P("zone", "Zone")],
    "dns zonecreate": [_P("server", "DNS server"), _P("zone", "Zone")],
    "dns zonedelete": [_P("server", "DNS server"), _P("zone", "Zone")],
    "dns query": [_P("server", "DNS server"), _P("zone", "Zone"), _P("name", "Name or @"),
                  _P("rtype", "A|AAAA|PTR|CNAME|NS|MX|SRV|TXT|ALL")],
    "dns add": [_P("server", "DNS server"), _P("zone", "Zone"), _P("name", "Name"), _P("rtype", "Type"), _P("data", "Data")],
    "dns update": [_P("server", "DNS server"), _P("zone", "Zone"), _P("name", "Name"), _P("rtype", "Type"),
                   _P("olddata", "Old data"), _P("newdata", "New data")],
    "dns delete": [_P("server", "DNS server"), _P("zone", "Zone"), _P("name", "Name"), _P("rtype", "Type"), _P("data", "Data")],
    # gpo
    "gpo listall": [],
    "gpo list": [_P("accountname", "User or computer")],
    "gpo show": [_P("gpo", "GPO GUID")],
    "gpo getlink": [_P("container_dn", "Container DN")],
    "gpo setlink": [_P("container_dn", "Container DN"), _P("gpo", "GPO GUID"),
                    _F("disable", "--disable", "Disable link", "switch"), _F("enforce", "--enforce", "Enforce", "switch")],
    "gpo dellink": [_P("container_dn", "Container DN"), _P("gpo", "GPO GUID")],
    "gpo getinheritance": [_P("container_dn", "Container DN")],
    "gpo setinheritance": [_P("container_dn", "Container DN"), _P("inherit_state", "block|inherit")],
    "gpo create": [_P("displayname", "Display name")],
    "gpo del": [_P("gpo", "GPO GUID")],
    "gpo aclcheck": [],
    # domain
    "domain passwordsettings show": [],
    "domain passwordsettings set": [_F("complexity", "--complexity=", "on|off|default"),
                                    _F("min-pwd-length", "--min-pwd-length=", "Minimum length", "int"),
                                    _F("history-length", "--history-length=", "History length", "int"),
                                    _F("min-pwd-age", "--min-pwd-age=", "Days", "int"),
                                    _F("max-pwd-age", "--max-pwd-age=", "Days", "int"),
                                    _F("account-lockout-duration", "--account-lockout-duration=", "Minutes", "int"),
                                    _F("account-lockout-threshold", "--account-lockout-threshold=", "Attempts", "int"),
                                    _F("reset-account-lockout-after", "--reset-account-lockout-after=", "Minutes", "int")],
    "domain passwordsettings pso list": [],
    "domain passwordsettings pso show": [_P("psoname", "PSO name")],
    "domain passwordsettings pso create": [_P("psoname", "PSO name"), _P("precedence", "Precedence", "int")],
    "domain passwordsettings pso set": [_P("psoname", "PSO name")],
    "domain passwordsettings pso delete": [_P("psoname", "PSO name")],
    "domain passwordsettings pso apply": [_P("psoname", "PSO name"), _P("user_or_group", "Target")],
    "domain passwordsettings pso unapply": [_P("psoname", "PSO name"), _P("user_or_group", "Target")],
    "domain level show": [],
    "domain level raise": [_F("domain-level", "--domain-level=", "2003|2008|2008_R2"),
                           _F("forest-level", "--forest-level=", "2003|2008|2008_R2")],
    "fsmo show": [],
    "dbcheck": [_F("cross-ncs", "--cross-ncs", "Check all partitions", "switch"),
                _F("fix", "--fix", "Fix errors", "switch"), _F("yes", "--yes", "Answer yes", "switch")],
    "drs showrepl": [],
    # sites
    "sites list": [],
    "sites view": [_P("sitename", "Site")],
    "sites create": [_P("sitename", "Site")],
    "sites remove": [_P("sitename", "Site")],
    "sites subnet create": [_P("subnetname", "Subnet CIDR"), _P("site_of_subnet", "Site")],
    "sites subnet remove": [_P("subnetname", "Subnet CIDR")],
    "sites subnet set-site": [_P("subnetname", "Subnet CIDR"), _P("site_of_subnet", "Site")],
    # spn
    "spn list": [_P("user", "Account")],
    "spn add": [_P("name", "SPN"), _P("user", "Account")],
    "spn delete": [_P("name", "SPN"), _P("user", "Account")],
    # delegation
    "delegation show": [_P("accountname", "Account")],
    "delegation for-any-service": [_P("accountname", "Account"), _P("onoff", "on|off")],
    "delegation for-any-protocol": [_P("accountname", "Account"), _P("onoff", "on|off")],
    "delegation add-service": [_P("accountname", "Account"), _P("principal", "Service principal")],
    "delegation del-service": [_P("accountname", "Account"), _P("principal", "Service principal")],
    # schema
    "schema attribute show": [_P("attribute", "Attribute LDAP name")],
}

# Families that talk to the DC over the network and need credentials.
NEEDS_CREDS = ("dns ", "gpo ", "drs ")

# Options a caller may not pass: they would change which config file,
# database or credentials samba-tool uses, or write files to arbitrary paths.
FORBIDDEN_OPTIONS = (
    "-s", "--configfile", "--option", "-H", "--URL", "-U", "--user", "-A",
    "--authentication-file", "-k", "--use-kerberos", "--krb5-ccache", "-P", "--machine-pass",
    "--simple-bind-dn", "--password", "--tmpdir", "--targetdir", "--entities",
    "--debug-stdout", "-d", "--debuglevel", "--ipaddress", "-W", "--workgroup", "-r", "--realm",
    "--use-ntvfs", "--use-s3fs", "--eadb-file", "--xattr-backend", "--service",
    "--editor", "--filename", "--outfile",
)

DESTRUCTIVE_WORDS = ("delete", "del", "remove", "removemembers", "demote", "reset",
                     "zonedelete", "dellink", "del-service", "unapply")


class SambaToolError(ValueError):
    pass


def catalog() -> list[dict]:
    return [{"command": c, "args": a} for c, a in sorted(COMMANDS.items())]


def needs_confirm(command: str) -> bool:
    words = command.split()
    return any(w in DESTRUCTIVE_WORDS or w.startswith(("delete", "remove", "demote", "reset"))
               for w in words)


def _check_arg(a) -> str:
    if not isinstance(a, str):
        raise SambaToolError("arguments must be strings")
    if "\x00" in a or "\n" in a or "\r" in a:
        raise SambaToolError("arguments may not contain control characters")
    if len(a) > 4096:
        raise SambaToolError("argument too long")
    if a.startswith("-"):
        opt = a.split("=", 1)[0]
        for f in FORBIDDEN_OPTIONS:
            if opt == f or (len(f) == 2 and opt.startswith(f) and not opt.startswith("--")):
                raise SambaToolError(f"option {opt} is not allowed")
    return a


def build_argv(command: str, args, confirm=None, samba_tool="samba-tool",
               cred_args: list[str] | None = None) -> list[str]:
    command = " ".join(str(command or "").split())
    if command not in COMMANDS:
        raise SambaToolError(f"command {command!r} is not in the allowlist")
    if args is None:
        args = []
    if not isinstance(args, list):
        raise SambaToolError("args must be a list of strings")
    if len(args) > 64:
        raise SambaToolError("too many arguments")
    clean = [_check_arg(a) for a in args]
    if needs_confirm(command) and confirm != command:
        raise SambaToolError(f'this command needs "confirm": "{command}"')
    argv = [samba_tool] + command.split() + clean
    if cred_args and command.startswith(NEEDS_CREDS):
        argv += cred_args
    return argv


def _cap(b: bytes) -> str:
    s = b[:OUTPUT_CAP].decode("utf-8", errors="replace")
    if len(b) > OUTPUT_CAP:
        s += "\n[output truncated at 1 MB]"
    return s


def run(argv: list[str], timeout: int = TIMEOUT, env=None) -> dict:
    """Run argv (no shell). Returns {"exitCode","stdout","stderr"}."""
    if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv):
        raise SambaToolError("argv must be a list of strings")
    try:
        p = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=timeout, shell=False, env=env)
    except subprocess.TimeoutExpired as e:
        return {"exitCode": -1, "stdout": _cap(e.stdout or b""),
                "stderr": _cap(e.stderr or b"") + f"\n[timed out after {timeout}s]"}
    except FileNotFoundError:
        return {"exitCode": 127, "stdout": "", "stderr": f"{argv[0]} not found"}
    return {"exitCode": p.returncode, "stdout": _cap(p.stdout), "stderr": _cap(p.stderr)}
