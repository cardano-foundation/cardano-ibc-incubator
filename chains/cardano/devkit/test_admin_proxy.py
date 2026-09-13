from collections import Counter
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from admin_proxy import handler_for


UTXOS = "/local-cluster/api/addresses/addr_test1example/utxos"


class AdminProxyTests(unittest.TestCase):
    def setUp(self):
        self.calls = Counter()
        self.responses = {}
        self.bodies = []
        owner = self

        class NativeApi(BaseHTTPRequestHandler):
            def handle_request(self):
                key = (self.command, self.path)
                owner.calls[key] += 1
                length = int(self.headers.get("Content-Length", "0"))
                owner.bodies.append(self.rfile.read(length))
                replies = owner.responses[key]
                status, content_type, body = replies.pop(0) if len(replies) > 1 else replies[0]
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Native-Header", "preserved")
                self.end_headers()
                self.wfile.write(body)

            do_GET = do_POST = handle_request

            def log_message(self, *_):
                pass

        self.native = ThreadingHTTPServer(("127.0.0.1", 0), NativeApi)
        self.proxy = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(f"http://127.0.0.1:{self.native.server_port}"))
        self.servers = [self.native, self.proxy]
        self.threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in self.servers]
        for thread in self.threads:
            thread.start()
        self.addCleanup(self.stop_servers)
        self.sleep = patch("admin_proxy.time.sleep")
        self.sleep.start()
        self.addCleanup(self.sleep.stop)

    def stop_servers(self):
        for server in self.servers:
            server.shutdown()
            server.server_close()
        for thread in self.threads:
            thread.join()

    def request(self, path, body=None):
        return urlopen(Request(f"http://127.0.0.1:{self.proxy.server_port}" + path, data=body), timeout=5)

    def test_transient_empty_first_page_retries_then_returns_native_utxos(self):
        for query in ("", "?page=1&count=100"):
            path = UTXOS + query
            self.responses[("GET", path)] = [(200, "application/json", b"[]"),
                                              (200, "application/json", b" \n[] "),
                                              (200, "application/json", b'[{"tx_hash":"funding"}]')]
            with self.request(path) as response:
                self.assertEqual(response.read(), b'[{"tx_hash":"funding"}]')
            self.assertEqual(self.calls[("GET", path)], 3)

    def test_genuinely_empty_first_page_stops_after_five_attempts(self):
        self.responses[("GET", UTXOS)] = [(200, "application/json", b"[]")]
        with self.request(UTXOS) as response:
            self.assertEqual(response.read(), b"[]")
        self.assertEqual(self.calls[("GET", UTXOS)], 5)

    def test_transient_epoch_query_errors_retry_before_returning_native_parameters(self):
        for path in ("/local-cluster/api/epochs/latest", "/local-cluster/api/epochs/4/parameters",
                     "/local-cluster/api/epochs/parameters"):
            self.responses[("GET", path)] = [(500, "application/json", b'{"error":"Local query race"}'),
                                              (200, "application/json", b'{"pool_deposit":"500000000"}')]
            with self.request(path) as response:
                self.assertEqual(response.read(), b'{"pool_deposit":"500000000"}')
            self.assertEqual(self.calls[("GET", path)], 2)

    def test_persistent_epoch_error_is_bounded_and_posts_are_not_repeated(self):
        path = "/local-cluster/api/epochs/4/parameters"
        for method, body, expected_calls in (("GET", None, 5), ("POST", b"{}", 1)):
            self.responses[(method, path)] = [(500, "application/json", b'{"error":"unavailable"}')]
            with self.assertRaises(HTTPError) as failure:
                self.request(path, body)
            with failure.exception as response:
                self.assertEqual(response.code, 500)
                self.assertEqual(response.read(), b'{"error":"unavailable"}')
            self.assertEqual(self.calls[(method, path)], expected_calls)

    def test_later_pages_other_paths_and_posts_are_never_retried(self):
        for path in (UTXOS + "?page=2", UTXOS + "?page=0", UTXOS + "?page=1&page=2", "/other/utxos"):
            self.responses[("GET", path)] = [(200, "application/json", b"[]")]
            with self.request(path) as response:
                self.assertEqual(response.read(), b"[]")
            self.assertEqual(self.calls[("GET", path)], 1)
        body = b'{"address":"addr_test1example","adaAmount":300000}'
        self.responses[("POST", UTXOS)] = [(200, "application/json", b"[]")]
        with self.request(UTXOS, body) as response:
            self.assertEqual(response.read(), b"[]")
        self.assertEqual(self.calls[("POST", UTXOS)], 1)
        self.assertEqual(self.bodies[-1], body)

    def test_native_chunked_post_body_is_forwarded_once(self):
        path = "/local-cluster/api/addresses/topup"
        body = b'{"address":"addr_test1example","adaAmount":1010}'
        self.responses[("POST", path)] = [(200, "application/json", b"[]")]
        connection = HTTPConnection("127.0.0.1", self.proxy.server_port, timeout=5)
        self.addCleanup(connection.close)
        try:
            connection.request("POST", path, body=[body[:12], body[12:]],
                               headers={"Content-Type": "application/json"}, encode_chunked=True)
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b"[]")
        finally:
            connection.close()
        self.assertEqual(self.calls[("POST", path)], 1)
        self.assertEqual(self.bodies[-1], body)

    def test_download_bytes_headers_and_http_errors_are_preserved(self):
        path = "/local-cluster/api/admin/devnet/download"
        archive = b"PK\x03\x04\x00\xff\x80genesis"
        self.responses[("GET", path)] = [(200, "application/zip", archive)]
        with self.request(path) as response:
            self.assertEqual(response.read(), archive)
            self.assertEqual(response.headers["Content-Type"], "application/zip")
            self.assertEqual(response.headers["X-Native-Header"], "preserved")
            self.assertEqual(int(response.headers["Content-Length"]), len(archive))
        self.responses[("GET", UTXOS)] = [(503, "application/json", b'{"error":"query unavailable"}')]
        with self.assertRaises(HTTPError) as failure:
            self.request(UTXOS)
        with failure.exception as response:
            self.assertEqual(response.code, 503)
            self.assertEqual(response.read(), b'{"error":"query unavailable"}')
        self.assertEqual(self.calls[("GET", UTXOS)], 1)


if __name__ == "__main__":
    unittest.main()
