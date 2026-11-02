"""http.server adapter: TLS ThreadingHTTPServer that feeds App.handle."""

from __future__ import annotations

import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from .app import MAX_BODY, App, Request, Response, parse_query


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "TempDeskAgent"
        sys_version = ""
        protocol_version = "HTTP/1.1"
        timeout = 30

        def log_message(self, fmt, *args):  # keep stdout quiet, audit log has the details
            pass

        def _serve(self):
            parts = urlsplit(self.path)
            length = self.headers.get("Content-Length")
            body = b""
            if length:
                try:
                    n = int(length)
                except ValueError:
                    return self._send(Response(400, {"error": "bad_request", "message": "bad Content-Length"}))
                if n < 0 or n > MAX_BODY:
                    self.close_connection = True
                    return self._send(Response(413, {"error": "bad_request", "message": "body too large"}))
                body = self.rfile.read(n)
            elif self.headers.get("Transfer-Encoding"):
                self.close_connection = True
                return self._send(Response(411, {"error": "bad_request", "message": "Content-Length required"}))
            req = Request(method=self.command, path=parts.path, query=parse_query(parts.query),
                          headers={k.lower(): v for k, v in self.headers.items()}, body=body,
                          remote=self.client_address[0])
            self._send(app.handle(req))

        def _send(self, resp: Response):
            data = resp.encode()
            self.send_response(resp.status)
            if resp.status != 204:
                self.send_header("Content-Type", resp.content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in resp.headers.items():
                self.send_header(k, v)
            self.end_headers()
            if data and self.command != "HEAD":
                self.wfile.write(data)

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _serve

    return Handler


class AgentHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64


def serve(app: App, host: str, port: int, certfile: str | None, keyfile: str | None):
    httpd = AgentHTTPServer((host, port), make_handler(app))
    if certfile:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(certfile, keyfile)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    return httpd
