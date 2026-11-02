"""TempDesk app streaming helpers: app catalog, Guacamole JSON auth, .rdp files."""

from .catalog import App, AppValidationError, apps_for_user, get_app, load_apps, remove_app, save_apps, upsert_app, validate_app, validate_apps
from .guac_json import build_app_payload, build_auth_json, client_identifier, client_url, encrypt_auth_json, rdp_parameters, tokens_request
from .rdp_file import content_disposition, rdp_bytes, rdp_filename, rdp_text, RDP_MEDIA_TYPE

__all__ = [
    "App", "AppValidationError", "apps_for_user", "get_app", "load_apps", "remove_app", "save_apps",
    "upsert_app", "validate_app", "validate_apps", "build_app_payload", "build_auth_json",
    "client_identifier", "client_url", "encrypt_auth_json", "rdp_parameters", "tokens_request",
    "content_disposition", "rdp_bytes", "rdp_filename", "rdp_text", "RDP_MEDIA_TYPE",
]
__version__ = "0.1.0"
