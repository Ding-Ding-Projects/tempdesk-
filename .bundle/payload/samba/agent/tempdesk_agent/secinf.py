"""GptTmpl.inf (security template) reading and writing, plus the catalog of
well known settings served by /security/catalog."""

from __future__ import annotations

import codecs

PATH = "Machine/Microsoft/Windows NT/SecEdit/GptTmpl.inf"
KEEP_SECTIONS = ("Unicode", "Version")


def decode(data: bytes) -> str:
    if data.startswith(codecs.BOM_UTF16_LE):
        return data[2:].decode("utf-16-le", errors="replace")
    if data.startswith(codecs.BOM_UTF8):
        return data[3:].decode("utf-8", errors="replace")
    # Heuristic: UTF-16 without BOM has NULs in every other byte
    if len(data) > 2 and data[1:2] == b"\x00":
        return data.decode("utf-16-le", errors="replace")
    return data.decode("utf-8", errors="replace")


def parse(text: str) -> dict[str, dict[str, str]]:
    sections: dict[str, dict[str, str]] = {}
    cur = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(";"):
            continue
        if line.startswith("[") and line.endswith("]"):
            cur = line[1:-1].strip()
            sections.setdefault(cur, {})
            continue
        if cur is None:
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            sections[cur][k.strip()] = v.strip()
        else:
            sections[cur][line] = ""
    return sections


def render(sections: dict[str, dict[str, str]], original: dict[str, dict[str, str]] | None = None) -> str:
    original = original or {}
    out = []
    uni = original.get("Unicode") or {"Unicode": "yes"}
    ver = original.get("Version") or {"signature": '"$CHICAGO$"', "Revision": "1"}
    for name, body in (("Unicode", uni), ("Version", ver)):
        out.append(f"[{name}]")
        out += [f"{k}={v}" for k, v in body.items()]
    for name, body in sections.items():
        if name in KEEP_SECTIONS:
            continue
        if not isinstance(body, dict):
            raise ValueError(f"section {name} must be an object")
        if "[" in name or "]" in name or "\n" in name:
            raise ValueError("bad section name")
        out.append(f"[{name}]")
        for k, v in body.items():
            k, v = str(k), "" if v is None else str(v)
            if any(c in k + v for c in "\r\n") or "=" in k:
                raise ValueError("bad key or value")
            out.append(f"{k} = {v}" if v != "" else k)
    return "\r\n".join(out) + "\r\n"


def encode(text: str) -> bytes:
    return codecs.BOM_UTF16_LE + text.encode("utf-16-le")


def _n(key, label, help_, type_="number"):
    return {"key": key, "label": label, "type": type_, "help": help_}


CATALOG = {
    "System Access": [
        _n("MinimumPasswordLength", "Minimum password length", "Characters, 0 to 14 (Samba accepts up to 255)."),
        _n("PasswordComplexity", "Password must meet complexity requirements", "1 enabled, 0 disabled.", "bool"),
        _n("MaximumPasswordAge", "Maximum password age", "Days, 0 means never expire."),
        _n("MinimumPasswordAge", "Minimum password age", "Days."),
        _n("PasswordHistorySize", "Enforce password history", "Number of remembered passwords."),
        _n("ClearTextPassword", "Store passwords using reversible encryption", "1 enabled, 0 disabled.", "bool"),
        _n("LockoutBadCount", "Account lockout threshold", "Failed attempts, 0 never locks."),
        _n("LockoutDuration", "Account lockout duration", "Minutes."),
        _n("ResetLockoutCount", "Reset lockout counter after", "Minutes."),
        _n("ForceLogoffWhenHourExpire", "Force logoff when logon hours expire", "1 enabled, 0 disabled.", "bool"),
        _n("LSAAnonymousNameLookup", "Allow anonymous SID/name translation", "1 enabled, 0 disabled.", "bool"),
        _n("EnableGuestAccount", "Guest account status (built in Guest)", "1 enabled, 0 disabled.", "bool"),
        _n("NewAdministratorName", "Rename administrator account", "Quoted name.", "text"),
    ],
    "Kerberos Policy": [
        _n("MaxTicketAge", "Maximum lifetime for user ticket", "Hours."),
        _n("MaxRenewAge", "Maximum lifetime for user ticket renewal", "Days."),
        _n("MaxServiceAge", "Maximum lifetime for service ticket", "Minutes."),
        _n("MaxClockSkew", "Maximum tolerance for clock synchronization", "Minutes."),
        _n("TicketValidateClient", "Enforce user logon restrictions", "1 enabled, 0 disabled.", "bool"),
    ],
    "Privilege Rights": [
        _n("SeInteractiveLogonRight", "Allow log on locally", "Comma separated *SIDs or names.", "principals"),
        _n("SeDenyInteractiveLogonRight", "Deny log on locally", "Comma separated *SIDs or names.", "principals"),
        _n("SeRemoteInteractiveLogonRight", "Allow log on through Remote Desktop Services", "Principals.", "principals"),
        _n("SeDenyRemoteInteractiveLogonRight", "Deny log on through Remote Desktop Services", "Principals.", "principals"),
        _n("SeNetworkLogonRight", "Access this computer from the network", "Principals.", "principals"),
        _n("SeDenyNetworkLogonRight", "Deny access to this computer from the network", "Principals.", "principals"),
        _n("SeShutdownPrivilege", "Shut down the system", "Principals.", "principals"),
        _n("SeRemoteShutdownPrivilege", "Force shutdown from a remote system", "Principals.", "principals"),
        _n("SeSystemtimePrivilege", "Change the system time", "Principals.", "principals"),
        _n("SeTimeZonePrivilege", "Change the time zone", "Principals.", "principals"),
        _n("SeBackupPrivilege", "Back up files and directories", "Principals.", "principals"),
        _n("SeRestorePrivilege", "Restore files and directories", "Principals.", "principals"),
        _n("SeTakeOwnershipPrivilege", "Take ownership of files or other objects", "Principals.", "principals"),
        _n("SeLoadDriverPrivilege", "Load and unload device drivers", "Principals.", "principals"),
        _n("SeBatchLogonRight", "Log on as a batch job", "Principals.", "principals"),
        _n("SeServiceLogonRight", "Log on as a service", "Principals.", "principals"),
    ],
    "Event Audit": [
        _n(k, label, "0 none, 1 success, 2 failure, 3 both.") for k, label in [
            ("AuditSystemEvents", "Audit system events"), ("AuditLogonEvents", "Audit logon events"),
            ("AuditObjectAccess", "Audit object access"), ("AuditPrivilegeUse", "Audit privilege use"),
            ("AuditPolicyChange", "Audit policy change"), ("AuditAccountManage", "Audit account management"),
            ("AuditProcessTracking", "Audit process tracking"), ("AuditDSAccess", "Audit directory service access"),
            ("AuditAccountLogon", "Audit account logon events")]
    ],
    "Registry Values": [
        _n(r"MACHINE\System\CurrentControlSet\Control\Lsa\LimitBlankPasswordUse",
           "Accounts: Limit local account use of blank passwords to console logon only", "Format 4,1 or 4,0.", "regvalue"),
        _n(r"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\DontDisplayLastUserName",
           "Interactive logon: Do not display last signed in", "Format 4,1 or 4,0.", "regvalue"),
        _n(r"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\DisableCAD",
           "Interactive logon: Do not require CTRL+ALT+DEL", "Format 4,1 or 4,0.", "regvalue"),
        _n(r"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\InactivityTimeoutSecs",
           "Interactive logon: Machine inactivity limit", "Format 4,<seconds>.", "regvalue"),
        _n(r"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\LegalNoticeCaption",
           "Interactive logon: Message title for users attempting to log on", 'Format 1,"text".', "regvalue"),
        _n(r"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\LegalNoticeText",
           "Interactive logon: Message text for users attempting to log on", "Format 7,line1,line2.", "regvalue"),
        _n(r"MACHINE\System\CurrentControlSet\Services\LanManServer\Parameters\RequireSecuritySignature",
           "Microsoft network server: Digitally sign communications (always)", "Format 4,1 or 4,0.", "regvalue"),
        _n(r"MACHINE\System\CurrentControlSet\Control\Lsa\RestrictAnonymous",
           "Network access: Do not allow anonymous enumeration of SAM accounts and shares", "Format 4,1.", "regvalue"),
        _n(r"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\EnableLUA",
           "User Account Control: Run all administrators in Admin Approval Mode", "Format 4,1.", "regvalue"),
    ],
    "Group Membership": [
        {"key": "*S-1-5-32-544__Members", "label": "Builtin Administrators: members", "type": "principals",
         "help": "Restricted groups. Comma separated *SIDs."},
        {"key": "*S-1-5-32-555__Members", "label": "Remote Desktop Users: members", "type": "principals",
         "help": "Restricted groups. Comma separated *SIDs."},
    ],
    "Service General Setting": [
        {"key": '"ServiceName",2,""', "label": "Service startup (name,mode,sddl)", "type": "text",
         "help": "Mode 2 automatic, 3 manual, 4 disabled. Written as a raw line."},
    ],
    "File Security": [
        {"key": '"%SystemRoot%\\path",0,"D:PAR(A;OICI;FA;;;BA)"', "label": "File or folder ACL", "type": "text",
         "help": "Raw line: path, mode (0 configure, 1 ignore, 2 replace), SDDL."},
    ],
}
