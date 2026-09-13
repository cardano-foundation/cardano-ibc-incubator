"""Retry DevKit's transient empty UTxO reads without repeating transactions."""

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
    attempts = 5 if first_page_utxos(method, path) else 1
    for attempt in range(attempts):
        try:
            response = urlopen(request, timeout=10)
        except HTTPError as error:
            # Preserve native API failures, including their response bodies.
            response = error
        with response:
            status, response_headers, content = response.status, list(response.headers.items()), response.read()
        if status != 200 or attempt + 1 == attempts:
            break
        try:
            empty = json.loads(content) == []
        except (ValueError, UnicodeDecodeError):
            empty = False
        if not empty:
            break
        time.sleep(0.2)
    return status, response_headers, content


def handler_for(upstream="http://127.0.0.1:10000"):
    class Handler(BaseHTTPRequestHandler):
        def proxy(self):
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
