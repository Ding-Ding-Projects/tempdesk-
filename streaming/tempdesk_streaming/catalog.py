"""App catalog: the list of streamable Windows apps kept in the TempDesk
settings document under the "apps" key.

Everything here works on plain dicts and lists. Nothing reads or writes files:
the portal gets the settings document from the agent (GET /settings), calls
these helpers, and sends the result back (PUT /settings).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Any, Iterable, Mapping

APP_ID_RE = re.compile(r"^[a-z0-9-]{1,40}$")
# Host names: DNS names or IPv4 addresses. IPv6 literals are allowed too.
HOST_RE = re.compile(r"^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,62})(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}))*\.?$")
IPV6_RE = re.compile(r"^[0-9A-Fa-f:]{2,39}$")

RDP_SECURITY_MODES = ("nla", "nla-ext", "tls", "rdp", "vmconnect", "any")
RESIZE_METHODS = ("display-update", "reconnect", "")

# Characters that would break a .rdp line or a registry value.
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


class AppValidationError(ValueError):
    """Raised when an app entry is invalid. `errors` maps field to message."""

    def __init__(self, errors: Mapping[str, str], index: int | None = None):
        self.errors = dict(errors)
        self.index = index
        where = f"apps[{index}]: " if index is not None else ""
        super().__init__(where + "; ".join(f"{k}: {v}" for k, v in self.errors.items()))


@dataclass
class App:
    id: str
    name: str
    host: str
    program: str
    description: str = ""
    icon: str = ""
    port: int = 3389
    arguments: str = ""
    workingDir: str = ""
    groups: list[str] = field(default_factory=list)
    enabled: bool = True
    rdpSecurity: str = "nla"
    ignoreCert: bool = False
    resizeMethod: str = "display-update"
    disableCopy: bool = False
    disablePaste: bool = False
    enablePrinting: bool = False
    hostPath: str = ""

    # ------------------------------------------------------------------ helpers
    @property
    def remote_app(self) -> str:
        """The value for Guacamole `remote-app` and .rdp `remoteapplicationprogram`.

        Aliases keep their "||" prefix (that is how RDP marks an alias from the
        TSAppAllowList). Full paths are passed as they are.
        """
        return self.program

    @property
    def alias(self) -> str | None:
        """The TSAppAllowList alias without "||", or None for a full path."""
        return self.program[2:] if self.program.startswith("||") else None

    def allowed_for(self, user_groups: Iterable[str]) -> bool:
        """True when the app is enabled and the user may launch it.

        Group names compare case-insensitively, like AD does. An empty
        `groups` list means every signed-in user.
        """
        if not self.enabled:
            return False
        if not self.groups:
            return True
        wanted = {g.casefold() for g in self.groups}
        return any(g.casefold() in wanted for g in user_groups)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_FIELDS = {f for f in App.__dataclass_fields__}  # type: ignore[attr-defined]


def _is_bool(v: Any) -> bool:
    return isinstance(v, bool)


def validate_app(data: Mapping[str, Any], index: int | None = None) -> App:
    """Validate one raw dict and return an App. Raises AppValidationError."""
    if not isinstance(data, Mapping):
        raise AppValidationError({"_": "app entry must be an object"}, index)
    errors: dict[str, str] = {}

    unknown = set(data) - _FIELDS
    if unknown:
        errors["_"] = "unknown fields: " + ", ".join(sorted(unknown))

    def text(key: str, required: bool = False, max_len: int = 260, default: str = "") -> str:
        v = data.get(key, default)
        if v is None:
            v = default
        if not isinstance(v, str):
            errors[key] = "must be a string"
            return default
        v = v.strip() if key not in ("arguments",) else v
        if required and not v:
            errors[key] = "is required"
        elif len(v) > max_len:
            errors[key] = f"must be at most {max_len} characters"
        elif _CONTROL_RE.search(v):
            errors[key] = "must not contain control characters or line breaks"
        return v

    app_id = text("id", required=True, max_len=40)
    if app_id and "id" not in errors and not APP_ID_RE.match(app_id):
        errors["id"] = "must match ^[a-z0-9-]{1,40}$"

    name = text("name", required=True, max_len=80)
    description = text("description", max_len=500)

    icon = data.get("icon", "") or ""
    if not isinstance(icon, str):
        errors["icon"] = "must be a string"
        icon = ""
    elif icon:
        if icon.startswith("data:"):
            if not re.match(r"^data:image/(png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$", icon):
                errors["icon"] = "data URL must be a base64 image (png, jpeg, gif, webp, svg, ico)"
            elif len(icon) > 200_000:
                errors["icon"] = "data URL is too large (limit about 150 KB)"
        elif len(icon) > 16 or _CONTROL_RE.search(icon) or icon.isascii():
            errors["icon"] = "must be an image data URL or a short emoji"

    host = text("host", required=True, max_len=253)
    if host and "host" not in errors and not (HOST_RE.match(host) or IPV6_RE.match(host)):
        errors["host"] = "must be a DNS name or IP address"

    port = data.get("port", 3389)
    if port is None:
        port = 3389
    if _is_bool(port) or not isinstance(port, int) or not 1 <= port <= 65535:
        errors["port"] = "must be an integer from 1 to 65535"
        port = 3389

    program = text("program", required=True, max_len=260)
    if program and "program" not in errors:
        if program.startswith("||"):
            if not re.match(r"^\|\|[A-Za-z0-9._-]{1,64}$", program):
                errors["program"] = "alias must be || followed by 1-64 letters, digits, dot, dash or underscore"
        elif not re.match(r"^([A-Za-z]:\\|%[A-Za-z0-9_]+%\\|\\\\)", program):
            errors["program"] = 'must be a RemoteApp alias such as "||notepad" or a full Windows path'

    host_path = text("hostPath", max_len=260)
    if host_path and "hostPath" not in errors and not re.match(r"^([A-Za-z]:\\|%[A-Za-z0-9_]+%\\)", host_path):
        errors["hostPath"] = "must be a full Windows path to the program on the app host"

    arguments = text("arguments", max_len=1024)
    working_dir = text("workingDir", max_len=260)

    groups = data.get("groups", []) or []
    if not isinstance(groups, list) or not all(isinstance(g, str) and g.strip() for g in groups):
        errors["groups"] = "must be a list of non-empty group names"
        groups = []
    else:
        groups = [g.strip() for g in groups]
        if any(len(g) > 256 or _CONTROL_RE.search(g) for g in groups):
            errors["groups"] = "group names must be at most 256 characters without control characters"

    bools: dict[str, bool] = {}
    for key, default in (("enabled", True), ("ignoreCert", False), ("disableCopy", False),
                         ("disablePaste", False), ("enablePrinting", False)):
        v = data.get(key, default)
        if v is None:
            v = default
        if not _is_bool(v):
            errors[key] = "must be true or false"
            v = default
        bools[key] = v

    security = data.get("rdpSecurity", "nla") or "nla"
    if security not in RDP_SECURITY_MODES:
        errors["rdpSecurity"] = "must be one of " + ", ".join(RDP_SECURITY_MODES)

    resize = data.get("resizeMethod", "display-update")
    if resize is None:
        resize = "display-update"
    if resize not in RESIZE_METHODS:
        errors["resizeMethod"] = 'must be "display-update", "reconnect" or ""'

    if errors:
        raise AppValidationError(errors, index)

    return App(
        id=app_id, name=name, description=description, icon=icon, host=host, port=port,
        program=program, arguments=arguments, workingDir=working_dir, groups=groups,
        enabled=bools["enabled"], rdpSecurity=security, ignoreCert=bools["ignoreCert"],
        resizeMethod=resize, disableCopy=bools["disableCopy"],
        disablePaste=bools["disablePaste"], enablePrinting=bools["enablePrinting"],
        hostPath=host_path,
    )


def validate_apps(items: Any) -> list[App]:
    """Validate a whole list. Rejects duplicate ids."""
    if items is None:
        return []
    if not isinstance(items, list):
        raise AppValidationError({"apps": "must be a list"})
    apps: list[App] = []
    seen: set[str] = set()
    for i, raw in enumerate(items):
        app = validate_app(raw, i)
        if app.id in seen:
            raise AppValidationError({"id": f"duplicate id {app.id!r}"}, i)
        seen.add(app.id)
        apps.append(app)
    return apps


# ------------------------------------------------------------------ settings
def load_apps(settings: Mapping[str, Any]) -> list[App]:
    """Read and validate settings["apps"]. A missing key means no apps."""
    return validate_apps(settings.get("apps", []))


def dump_apps(apps: Iterable[App]) -> list[dict[str, Any]]:
    return [a.to_dict() for a in apps]


def save_apps(settings: Mapping[str, Any], apps: Iterable[App | Mapping[str, Any]]) -> dict[str, Any]:
    """Return a copy of `settings` with "apps" replaced by the validated list.

    Every other key is kept as it is. The input dict is not modified.
    """
    raw = [a.to_dict() if isinstance(a, App) else dict(a) for a in apps]
    validated = validate_apps(raw)
    out = dict(settings)
    out["apps"] = dump_apps(validated)
    return out


def upsert_app(settings: Mapping[str, Any], app: App | Mapping[str, Any]) -> dict[str, Any]:
    """Add or replace one app (matched by id) and return new settings."""
    new = app if isinstance(app, App) else validate_app(app)
    current = load_apps(settings)
    replaced = [new if a.id == new.id else a for a in current]
    if not any(a.id == new.id for a in current):
        replaced.append(new)
    return save_apps(settings, replaced)


def remove_app(settings: Mapping[str, Any], app_id: str) -> dict[str, Any]:
    """Remove the app with this id (no error when absent) and return new settings."""
    return save_apps(settings, [a for a in load_apps(settings) if a.id != app_id])


def get_app(settings: Mapping[str, Any], app_id: str) -> App | None:
    for a in load_apps(settings):
        if a.id == app_id:
            return a
    return None


def apps_for_user(settings: Mapping[str, Any], user_groups: Iterable[str]) -> list[App]:
    """Enabled apps this user may launch, in catalog order."""
    groups = list(user_groups)
    return [a for a in load_apps(settings) if a.allowed_for(groups)]
