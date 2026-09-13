"""Retry DevKit's transient ledger reads without repeating transactions."""

import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request, urlopen


HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
               "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"}


def first_page_utxos(method, path):
    url = urlsplit(path)
    if method != "GET" or not re.fullmatch(r"/local-cluster/api/addresses/[^/]+/utxos", url.path):
        return False
    pages = parse_qs(url.query, keep_blank_values=True).get("page", ["1"])
    return len(pages) == 1 and pages[0] == "1"


def forward(method, path, headers, body, upstream="http://127.0.0.1:10000"):
    headers = {key: value for key, value in headers.items()
               if key.lower() not in HOP_HEADERS | {"host", "content-length"}}
    request = Request(upstream + path, data=body, headers=headers, method=method)
    epoch_query = method == "GET" and re.fullmatch(
        r"/local-cluster/api/epochs/(?:latest|(?:[0-9]+/)?parameters)", urlsplit(path).path)
    attempts = 5 if first_page_utxos(method, path) or epoch_query else 1
    for attempt in range(attempts):
        try:
            # The native faucet waits for inclusion before returning its POST.
            response = urlopen(request, timeout=10 if method in ("GET", "HEAD") else 90)
        except HTTPError as error:
            # Preserve native API failures, including their response bodies.
            response = error
        with response:
            status, response_headers, content = response.status, list(response.headers.items()), response.read()
        retry_error = epoch_query and status in (500, 502, 503, 504)
        if status != 200 and not retry_error or attempt + 1 == attempts:
            break
        try:
            empty = json.loads(content) == []
        except (ValueError, UnicodeDecodeError):
            empty = False
        if not empty and not retry_error:
            break
        time.sleep(0.2)
    return status, response_headers, content


def handler_for(upstream="http://127.0.0.1:10000"):
    class Handler(BaseHTTPRequestHandler):
        def proxy(self):
            if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                chunks = []
                while True:
                    size = int(self.rfile.readline().split(b";", 1)[0].strip(), 16)
                    if size == 0:
                        while self.rfile.readline().strip():
                            pass
                        break
                    chunks.append(self.rfile.read(size))
                    self.rfile.read(2)
                body = b"".join(chunks)
            else:
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length) if length else None
            try:
                status, headers, content = forward(self.command, self.path, self.headers, body, upstream)
            except (OSError, URLError) as error:
                status, headers = 502, [("Content-Type", "application/json")]
                content = json.dumps({"error": f"DevKit admin API unavailable: {error}"}).encode()
            self.send_response(status)
            for key, value in headers:
                if key.lower() not in HOP_HEADERS | {"content-length", "server", "date"}:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(content)

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_HEAD = proxy

        def log_message(self, *_):
            pass

    return Handler


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 10001), handler_for()).serve_forever()
