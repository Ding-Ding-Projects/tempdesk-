"""Probe the local portal listener without using agent or session credentials."""

import http.client
import os
import socket
import ssl
import sys

from .config import ConfigError, portal_port, portal_tls_files


def _status(connection: socket.socket) -> int:
    connection.sendall(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
    with http.client.HTTPResponse(connection) as response:
        response.begin()
        return response.status


def main() -> int:
    env = os.environ
    try:
        cert, _ = portal_tls_files(env)
        with socket.create_connection(("127.0.0.1", portal_port(env)), timeout=4) as listener:
            if cert:
                name = (env.get("TLS_HEALTHCHECK_NAME") or "").strip() or "localhost"
                ca_file = (env.get("TLS_HEALTHCHECK_CA_FILE") or "").strip() or None
                context = ssl.create_default_context(cafile=ca_file)
                with context.wrap_socket(listener, server_hostname=name) as secured:
                    status = _status(secured)
            else:
                status = _status(listener)
    except ConfigError as error:
        print(error, file=sys.stderr)
        return 1
    except ssl.SSLCertVerificationError:
        print("Portal liveness could not verify the HTTPS certificate issuer or name", file=sys.stderr)
        return 1
    except (OSError, ValueError, http.client.HTTPException):
        print("Portal liveness could not reach the configured local listener", file=sys.stderr)
        return 1
    if status != 200:
        print(f"Portal liveness returned HTTP {status}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
