"""Expose observed local Cardano epoch nonces and active stake over HTTP."""

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


class NonceHistory:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()
        self.genesis = None
        self.nonces = {}
        self.stakes = {}
        self.conflicts = set()
        self.current_epoch = None
        self.last_success = None
        if self.path.exists():
            saved = json.loads(self.path.read_text())
            if saved.get("version") not in (1, 2, 3):
                raise ValueError("Unsupported epoch nonce history format")
            self.genesis = saved["genesis"]
            for epoch, nonce in saved["nonces"].items():
                if not re.fullmatch(r"0|[1-9][0-9]*", epoch) or not valid_nonce(nonce):
                    raise ValueError("Invalid saved epoch nonce")
                self.nonces[int(epoch)] = nonce.lower()
            # Older files did not retain frozen VRF keys. Keep their nonces,
            # but never fill historical keys from a later pool registration.
            for epoch, snapshot in (saved.get("stakes", {}) if saved["version"] == 3 else {}).items():
                if not re.fullmatch(r"0|[1-9][0-9]*", epoch) or int(epoch) not in self.nonces:
                    raise ValueError("Saved stake snapshot has no matching epoch nonce")
                self.stakes[int(epoch)] = validate_snapshot(snapshot)
            self.conflicts = set(saved.get("conflicts", []))
            if not self.conflicts.issubset(self.nonces):
                raise ValueError("Invalid conflicting epoch history")

    def persist(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        with temporary.open("w") as output:
            json.dump({"version": 3, "genesis": self.genesis,
                       "nonces": {str(key): value for key, value in sorted(self.nonces.items())},
                       "stakes": {str(key): value for key, value in sorted(self.stakes.items())},
                       "conflicts": sorted(self.conflicts)}, output)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(self.path)

    def record(self, genesis, epoch, nonce, snapshot=None):
        if not isinstance(epoch, int) or isinstance(epoch, bool) or epoch < 0 or not valid_nonce(nonce):
            raise ValueError("Invalid epoch or nonce from Cardano node")
        nonce = nonce.lower()
        if snapshot is not None:
            snapshot = validate_snapshot(snapshot)
        with self.lock:
            changed = (self.genesis != genesis or self.nonces.get(epoch) != nonce
                       or self.stakes.get(epoch) != snapshot)
            if self.genesis != genesis:
                self.genesis = genesis
                self.nonces = {}
                self.stakes = {}
                self.conflicts = set()
            previous_epoch = self.current_epoch if self.current_epoch is not None else max(self.nonces, default=epoch)
            # A node that rolled back into an earlier epoch cannot vouch for
            # the previous boundary observation or its future epochs.
            future = [known for known in self.nonces if known >= epoch] if epoch < previous_epoch else []
            for known in future:
                del self.nonces[known]
                self.stakes.pop(known, None)
                self.conflicts.discard(known)
            if (epoch in self.conflicts
                    or epoch in self.nonces and self.nonces[epoch] != nonce
                    or epoch in self.stakes and self.stakes[epoch] != snapshot):
                # Never resume serving an ambiguous historical snapshot when
                # collection moves on to another epoch or the process restarts.
                self.last_success = None
                if epoch not in self.conflicts:
                    self.conflicts.add(epoch)
                    self.persist()
                raise ValueError(f"Conflicting nonce or active stake observed for epoch {epoch}")
            self.nonces[epoch] = nonce
            if snapshot is not None:
                self.stakes[epoch] = snapshot
            if changed or future:
                self.persist()
            self.current_epoch = epoch
            self.last_success = time.monotonic()

    def response(self, epoch=None, stake=False):
        with self.lock:
            # Loading a file alone does not establish which chain is running.
            if self.last_success is None or time.monotonic() - self.last_success > 30:
                return 503, {"error": "Waiting for a current Cardano epoch observation"}
            if epoch is None:
                return 200, {"epoch": self.current_epoch,
                             "observed_epochs": sorted(set(self.nonces) - self.conflicts),
                             "observed_stake_epochs": sorted(set(self.stakes) - self.conflicts)}
            if epoch in self.conflicts:
                return 404, {"error": f"Conflicting epoch context was observed for epoch {epoch}"}
            if stake:
                if epoch not in self.stakes:
                    return 404, {"error": f"No active stake snapshot was observed for epoch {epoch}"}
                return 200, {"epoch_no": epoch, **self.stakes[epoch]}
            if epoch not in self.nonces:
                return 404, {"error": f"No nonce was observed for epoch {epoch}"}
            return 200, [{"epoch_no": epoch, "nonce": self.nonces[epoch]}]

    def unavailable(self):
        with self.lock:
            self.last_success = None


def valid_nonce(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{64}", value) is not None


def unsigned_integer(value):
    if isinstance(value, bool) or not re.fullmatch(r"0|[1-9][0-9]*", str(value)):
        raise ValueError("Invalid integer in active stake snapshot")
    return int(value)


def normalize_stake(total, pools):
    total = unsigned_integer(total)
    seen = set()
    active = []
    for pool_id, stake in pools:
        if not isinstance(pool_id, str) or not re.fullmatch(r"[0-9a-fA-F]{56}", pool_id):
            raise ValueError("Invalid pool ID in active stake snapshot")
        pool_id = pool_id.lower()
        if pool_id in seen:
            raise ValueError("Duplicate pool ID in active stake snapshot")
        seen.add(pool_id)
        stake = unsigned_integer(stake)
        if stake > 0:
            active.append({"pool_id_hex": pool_id, "active_stake": str(stake)})
    if sum(int(pool["active_stake"]) for pool in active) != total:
        raise ValueError("Pool Set stakes do not sum to total Set stake")
    if total == 0:
        # The genesis producer can forge before the first Set snapshot exists.
        # Preserve its nonce without inventing stake evidence for that epoch.
        return None
    return {"total_active_stake": str(total), "pools": sorted(active, key=lambda pool: pool["pool_id_hex"])}


def validate_snapshot(snapshot):
    normalized = normalize_stake(snapshot["total_active_stake"],
                                 [(pool["pool_id_hex"], pool["active_stake"]) for pool in snapshot["pools"]])
    if normalized is None:
        raise ValueError("Active stake snapshot must have positive total stake")
    return attach_vrf_keys(normalized, {pool["pool_id_hex"].lower(): {"vrf": pool.get("vrf_key_hash")}
                                       for pool in snapshot["pools"]})


def attach_vrf_keys(snapshot, pool_params):
    if snapshot is None:
        return None
    for pool in snapshot["pools"]:
        vrf = pool_params.get(pool["pool_id_hex"], {}).get("vrf")
        if not valid_nonce(vrf):
            raise ValueError("Frozen Set VRF key is unavailable for active pool " + pool["pool_id_hex"])
        pool["vrf_key_hash"] = vrf.lower()
    return snapshot


def cli_query(query, magic, *args):
    result = subprocess.run(["cardano-cli", "query", query, "--testnet-magic", str(magic), *args],
                            check=True, capture_output=True, text=True, timeout=10)
    return json.loads(result.stdout)


def observe(history, genesis_directory, query=cli_query):
    genesis_directory = Path(genesis_directory)
    genesis = {era: json.loads((genesis_directory / f"{era}-genesis.json").read_text())
               for era in ("byron", "shelley")}
    identity = hashlib.sha256(json.dumps(genesis, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    magic = genesis["shelley"]["networkMagic"]
    before = query("tip", magic)
    state = query("protocol-state", magic)
    raw_snapshot = query("stake-snapshot", magic, "--all-stake-pools")
    ledger = query("ledger-state", magic)
    after = query("tip", magic)
    epoch = before.get("epoch")
    if epoch is None or epoch != after.get("epoch") or epoch != ledger.get("lastEpoch"):
        raise ValueError("Epoch changed during nonce query")
    if before.get("slot") is None or after.get("slot") is None or after["slot"] < before["slot"]:
        raise ValueError("Cardano tip rolled back during nonce query")
    snapshot = normalize_stake(raw_snapshot["total"]["stakeSet"],
                               [(pool_id, values["stakeSet"]) for pool_id, values in raw_snapshot["pools"].items()])
    snapshot = attach_vrf_keys(snapshot, ledger["stateBefore"]["esSnapshots"]["pstakeSet"]["poolParams"])
    history.record(identity, epoch, state.get("epochNonce"), snapshot)


def handler_for(history):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            url = urlsplit(self.path)
            if url.path == "/health":
                status, body = history.response()
            elif url.path in ("/epoch_params", "/epoch_stake"):
                params = parse_qs(url.query, keep_blank_values=True)
                values = params.get("_epoch_no", [])
                if len(values) != 1 or not re.fullmatch(r"0|[1-9][0-9]*", values[0]):
                    status, body = 400, {"error": "Provide one nonnegative integer _epoch_no"}
                else:
                    status, body = history.response(int(values[0]), stake=url.path == "/epoch_stake")
            else:
                status, body = 404, {"error": "Unknown endpoint"}
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_):
            pass

    return Handler


def main():
    socket = Path(os.environ.get("CARDANO_NODE_SOCKET_PATH", "/clusters/nodes/default/node/node.sock"))
    history = NonceHistory("/data/epoch-nonces.json")

    def collect():
        last_error = None
        while True:
            try:
                observe(history, socket.parent / "genesis")
                last_error = None
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
                history.unavailable()
                message = str(error)
                if message != last_error:
                    print(f"Epoch nonce observation pending: {message}", file=sys.stderr, flush=True)
                    last_error = message
            time.sleep(2)

    threading.Thread(target=collect, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8080), handler_for(history)).serve_forever()


if __name__ == "__main__":
    main()
