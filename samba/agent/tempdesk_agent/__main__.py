"""Entry point: python3 -m tempdesk_agent

Environment:
  TEMPDESK_DATA       data folder (default /var/lib/tempdesk)
  TEMPDESK_BIND       listen address (default 0.0.0.0)
  TEMPDESK_PORT       overrides agent.json port (default 8443)
  TEMPDESK_FAKE=1     run against the in memory FakeBackend (development only)
"""

from __future__ import annotations

import base64
import os
import signal
import sys
import threading

from .app import App
from .auth import TokenSigner
from .stores import AuditLog, SettingsStore, load_or_create_agent_config


def reaper_loop(app: App, stop: threading.Event):
    while not stop.is_set():
        try:
            app.reap_once()
        except Exception as e:  # noqa: BLE001 - keep the loop alive
            app.audit.write(event="reaper_error", error=type(e).__name__, detail=str(e)[:500])
        minutes = max(1, int(app.settings.get().get("reaperIntervalMinutes", 5) or 5))
        stop.wait(minutes * 60)


def main(argv=None) -> int:
    data = os.environ.get("TEMPDESK_DATA", "/var/lib/tempdesk")
    os.makedirs(data, exist_ok=True)
    cfg = load_or_create_agent_config(data)
    settings = SettingsStore(os.path.join(data, "settings.json"))
    audit = AuditLog(os.path.join(data, "audit.log"))
    if os.environ.get("TEMPDESK_FAKE") == "1":
        import tempfile
        from .fake import FakeBackend
        backend = FakeBackend(tempfile.mkdtemp(prefix="tempdesk-sysvol-"))
    else:
        from .samba_backend import SambaBackend
        backend = SambaBackend(data_dir=data, settings_getter=settings.get)
    signer = TokenSigner(base64.b64decode(cfg["hmacSecret"]))
    app = App(backend, settings, audit, cfg["guestKey"], cfg["adminKey"], signer)

    from .server import serve
    host = os.environ.get("TEMPDESK_BIND", "0.0.0.0")
    port = int(os.environ.get("TEMPDESK_PORT", cfg.get("port", 8443)))
    cert, key = cfg.get("certFile"), cfg.get("keyFile")
    if not (cert and os.path.exists(cert) and key and os.path.exists(key)):
        print("agent TLS certificate or key missing; refusing to serve plain HTTP", file=sys.stderr)
        return 2
    httpd = serve(app, host, port, cert, key)

    stop = threading.Event()
    threading.Thread(target=reaper_loop, args=(app, stop), daemon=True, name="reaper").start()

    def shutdown(*_):
        stop.set()
        threading.Thread(target=httpd.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    audit.write(event="agent_started", port=port, backend=backend.name)
    print(f"TempDesk agent listening on https://{host}:{port}/api/v1", flush=True)
    httpd.serve_forever()
    audit.write(event="agent_stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
