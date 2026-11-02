""".rdp RemoteApp files for the built-in Windows Remote Desktop client (mstsc).

The file never contains a password. The client asks for it when the user
opens the file (prompt for credentials on client).

Encoding: mstsc writes .rdp files as UTF-16 LE with a byte order mark, and
reads that as well as plain UTF-8 or ANSI. We produce UTF-16 LE with BOM and
CRLF line endings so the file is byte-for-byte the kind mstsc itself saves,
and non-ASCII app names (for example "Word (Français)") survive on every
Windows locale.
"""

from __future__ import annotations

import re
import unicodedata

from .catalog import App

RDP_MEDIA_TYPE = "application/x-rdp"
_LINE_UNSAFE = re.compile(r"[\r\n\x00]")


def _s(value: str) -> str:
    # .rdp values run to the end of the line, so line breaks would inject settings.
    return _LINE_UNSAFE.sub(" ", value)


def rdp_lines(
    app: App,
    *,
    username: str = "",
    domain: str = "",
    gateway_host: str = "",
    authentication_level: int = 2,
) -> list[str]:
    """Lines of the .rdp file, in order.

    authentication_level: 0 connect without warning, 1 do not connect if server
    authentication fails, 2 warn (default, matches mstsc), 3 no requirement.
    """
    if authentication_level not in (0, 1, 2, 3):
        raise ValueError("authentication_level must be 0, 1, 2 or 3")
    address = app.host if app.port == 3389 else f"{app.host}:{app.port}"
    user = ""
    if username:
        user = f"{domain}\\{username}" if domain and "\\" not in username and "@" not in username else username

    lines = [
        f"full address:s:{_s(address)}",
        "remoteapplicationmode:i:1",
        f"remoteapplicationprogram:s:{_s(app.remote_app)}",
        f"remoteapplicationname:s:{_s(app.name)}",
        f"remoteapplicationcmdline:s:{_s(app.arguments)}",
        "disableremoteappcapscheck:i:1",
        "alternate shell:s:rdpinit.exe",
        f"shell working directory:s:{_s(app.workingDir)}",
        "prompt for credentials on client:i:1",
        "promptcredentialonce:i:1",
        f"authentication level:i:{authentication_level}",
        "enablecredsspsupport:i:1",
        f"redirectclipboard:i:{0 if (app.disableCopy and app.disablePaste) else 1}",
        f"redirectprinters:i:{1 if app.enablePrinting else 0}",
        "drivestoredirect:s:",
        "redirectdrives:i:0",
        "redirectcomports:i:0",
        "redirectsmartcards:i:0",
        "audiomode:i:0",
        "allow font smoothing:i:1",
        "screen mode id:i:2",
        "use multimon:i:0",
        "span monitors:i:0",
    ]
    if user:
        lines.append(f"username:s:{_s(user)}")
    if gateway_host:
        lines += [
            f"gatewayhostname:s:{_s(gateway_host)}",
            "gatewayusagemethod:i:1",
            "gatewaycredentialssource:i:0",
            "gatewayprofileusagemethod:i:1",
        ]
    else:
        lines += ["gatewayusagemethod:i:4", "gatewayprofileusagemethod:i:0"]
    return lines


def rdp_text(app: App, **kwargs) -> str:
    """The .rdp file as text with CRLF line endings."""
    return "\r\n".join(rdp_lines(app, **kwargs)) + "\r\n"


def rdp_bytes(app: App, **kwargs) -> bytes:
    """The .rdp file encoded as UTF-16 LE with BOM, ready to send."""
    return b"\xff\xfe" + rdp_text(app, **kwargs).encode("utf-16-le")


def rdp_filename(app: App) -> str:
    """A safe ASCII filename such as "notepad.rdp" (the id is already safe)."""
    return f"{app.id}.rdp"


def content_disposition(app: App) -> str:
    """Content-Disposition header value with an ASCII fallback and RFC 5987 name."""
    from urllib.parse import quote

    ascii_name = unicodedata.normalize("NFKD", app.name).encode("ascii", "ignore").decode("ascii")
    ascii_name = re.sub(r"[^A-Za-z0-9._ -]", "", ascii_name).strip() or app.id
    utf8_name = quote(f"{app.name}.rdp", safe="")
    return f'attachment; filename="{ascii_name}.rdp"; filename*=UTF-8\'\'{utf8_name}'
