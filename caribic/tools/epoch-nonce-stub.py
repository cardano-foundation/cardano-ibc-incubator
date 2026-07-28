"""Koios-format /epoch_params stub backed by live Ogmios nonce queries.

Serves [{"epoch_no": N, "nonce": "<hex>"}] for the CURRENT epoch only; other
epochs return 404 so stale data can never be served. Stopgap for the Koios
free-tier rate limit; run while testing, point
CARDANO_EPOCH_PARAMS_ENDPOINT=http://host.docker.internal:3999 at it.
"""
import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

def _env_from_file():
    values = {}
    for line in open('/Users/fabianbormann/workspace/cardano-ibc-incubator/cardano/gateway/.env'):
        line = line.strip()
        if line.startswith('OGMIOS_ENDPOINT=') or line.startswith('OGMIOS_API_KEY='):
            k, v = line.split('=', 1)
            values[k] = v.strip('"')
    return values

_vals = _env_from_file()
OGMIOS = os.environ.get('OGMIOS_ENDPOINT') or _vals['OGMIOS_ENDPOINT']
KEY = os.environ.get('OGMIOS_API_KEY') or _vals['OGMIOS_API_KEY']


def ogmios(method):
    req = urllib.request.Request(
        OGMIOS,
        data=json.dumps({'jsonrpc': '2.0', 'method': method, 'id': 1}).encode(),
        headers={'Content-Type': 'application/json', 'dmtr-api-key': KEY, 'User-Agent': 'curl/8.6.0'},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)['result']


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.rstrip('/').endswith('/epoch_params'):
            try:
                requested = int(parse_qs(parsed.query).get('_epoch_no', ['-1'])[0])
                current = ogmios('queryLedgerState/epoch')
                if requested == current:
                    nonce = ogmios('queryLedgerState/nonces')['epochNonce']
                    body = json.dumps([{'epoch_no': current, 'nonce': nonce}]).encode()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                self.send_response(404)
                self.end_headers()
                return
            except Exception as exc:
                self.send_response(502)
                self.end_headers()
                self.wfile.write(str(exc).encode())
                return
        self.send_response(404)
        self.end_headers()

    def log_message(self, *args):
        pass


HTTPServer(('0.0.0.0', 3999), Handler).serve_forever()
