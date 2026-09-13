import json
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import urlopen

from nonce import NonceHistory, attach_vrf_keys, handler_for, normalize_stake, observe


POOL_A = "aa" * 28
POOL_B = "bb" * 28
VRF_A = "12" * 32
VRF_B = "34" * 32


def raw_stake(first=300, second=100, mark=900):
    return {"total": {"stakeSet": first + second, "stakeMark": mark * 2, "stakeGo": 0},
            "pools": {POOL_A: {"stakeSet": first, "stakeMark": mark, "stakeGo": 0},
                      POOL_B: {"stakeSet": second, "stakeMark": mark, "stakeGo": 0}}}


def raw_ledger(epoch, first=VRF_A, second=VRF_B):
    return {"lastEpoch": epoch, "stateBefore": {"esSnapshots": {
        "pstakeSet": {"poolParams": {POOL_A: {"vrf": first}, POOL_B: {"vrf": second}}},
        "pstakeMark": {"poolParams": {POOL_A: {"vrf": "ff" * 32}}}}}}


def stake_row(pool_id, stake, vrf):
    return {"pool_id_hex": pool_id, "active_stake": str(stake), "vrf_key_hash": vrf}


class EpochNonceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.history = NonceHistory(self.root / "history.json")
        (self.root / "byron-genesis.json").write_text('{"startTime": 1}')
        (self.root / "shelley-genesis.json").write_text('{"systemStart": "start", "networkMagic": 42}')

    def sample(self, before, after, nonce="ab" * 32, snapshot=None, ledger=None):
        results = iter([before, {"epochNonce": nonce}, snapshot or raw_stake(),
                        ledger or raw_ledger(before.get("epoch")), after])
        calls = []

        def query(name, magic, *args):
            calls.append((name, magic, *args))
            return next(results)

        observe(self.history, self.root, query)
        self.assertEqual(calls, [("tip", 42), ("protocol-state", 42),
                                 ("stake-snapshot", 42, "--all-stake-pools"),
                                 ("ledger-state", 42), ("tip", 42)])

    def test_restart_requires_live_chain_identity_before_serving_history(self):
        self.sample({"epoch": 2, "slot": 1201}, {"epoch": 2, "slot": 1202})
        restarted = NonceHistory(self.root / "history.json")
        self.assertEqual(restarted.response(2)[0], 503)
        restarted.record(self.history.genesis, 3, "cd" * 32)
        self.assertEqual(restarted.response(2), (200, [{"epoch_no": 2, "nonce": "ab" * 32}]))
        self.assertEqual(restarted.response(3)[1][0]["nonce"], "cd" * 32)
        self.assertEqual(restarted.response(1)[0], 404)
        self.assertEqual(restarted.response(2, stake=True)[1]["total_active_stake"], "400")
        self.assertEqual(restarted.response(3, stake=True)[0], 404)

    def test_epoch_boundary_and_rollback_samples_are_never_persisted(self):
        for before, after in [({"epoch": 1, "slot": 1199}, {"epoch": 2, "slot": 1200}),
                              ({"epoch": 1, "slot": 650}, {"epoch": 1, "slot": 649})]:
            with self.subTest(before=before, after=after), self.assertRaises(ValueError):
                self.sample(before, after)
        self.assertFalse(self.history.path.exists())
        self.assertEqual(self.history.response()[0], 503)

    def test_genesis_reset_discards_previous_chain_nonces(self):
        self.sample({"epoch": 2, "slot": 1201}, {"epoch": 2, "slot": 1202})
        (self.root / "byron-genesis.json").write_text('{"startTime": 2}')
        self.sample({"epoch": 0, "slot": 1}, {"epoch": 0, "slot": 2}, "cd" * 32)
        self.assertEqual(self.history.response(2)[0], 404)
        self.assertEqual(self.history.response(2, stake=True)[0], 404)
        saved = json.loads(self.history.path.read_text())
        self.assertEqual(saved["nonces"], {"0": "cd" * 32})

    def test_rollback_to_previous_epoch_discards_future_observations(self):
        self.history.record("chain", 1, "ab" * 32)
        self.history.record("chain", 2, "cd" * 32)
        self.history.record("chain", 1, "ab" * 32)
        self.assertEqual(self.history.response(2)[0], 404)
        self.history.record("chain", 2, "ef" * 32)
        self.assertEqual(self.history.response(2)[1][0]["nonce"], "ef" * 32)

    def test_invalid_nonce_is_not_cached_and_stale_collector_is_unhealthy(self):
        with self.assertRaises(ValueError):
            self.sample({"epoch": 2, "slot": 1201}, {"epoch": 2, "slot": 1202}, "not-a-nonce")
        self.assertFalse(self.history.path.exists())
        self.history.record("chain", 2, "ab" * 32)
        with patch("nonce.time.monotonic", return_value=self.history.last_success + 31):
            self.assertEqual(self.history.response()[0], 503)
            self.assertEqual(self.history.response(2)[0], 503)

    def test_uses_set_stake_and_preserves_each_epochs_actual_snapshot(self):
        self.sample({"epoch": 2, "slot": 1201}, {"epoch": 2, "slot": 1202})
        # Mark can change during an epoch, it is not the stake used for forging.
        self.sample({"epoch": 2, "slot": 1301}, {"epoch": 2, "slot": 1302}, snapshot=raw_stake(mark=1800))
        self.sample({"epoch": 3, "slot": 1801}, {"epoch": 3, "slot": 1802}, "cd" * 32,
                    snapshot=raw_stake(first=500, second=500))
        self.assertEqual(self.history.response(2, stake=True), (200, {
            "epoch_no": 2, "total_active_stake": "400", "pools": [
                stake_row(POOL_A, 300, VRF_A), stake_row(POOL_B, 100, VRF_B)]}))
        self.assertEqual(self.history.response(3, stake=True)[1]["total_active_stake"], "1000")

    def test_empty_bootstrap_set_preserves_nonce_without_inventing_active_stake(self):
        self.sample({"epoch": 0, "slot": 1}, {"epoch": 0, "slot": 2}, snapshot=raw_stake(0, 0))
        self.assertEqual(self.history.response(0)[0], 200)
        self.assertEqual(self.history.response(0, stake=True)[0], 404)
        self.sample({"epoch": 1, "slot": 601}, {"epoch": 1, "slot": 602}, "cd" * 32,
                    snapshot=raw_stake(300, 0))
        self.assertEqual(self.history.response(1, stake=True)[1]["pools"],
                         [stake_row(POOL_A, 300, VRF_A)])
        self.assertEqual(self.history.response(0, stake=True)[0], 404)

    def test_mismatched_or_invalid_stakes_are_never_persisted(self):
        invalid = raw_stake()
        invalid["total"]["stakeSet"] = 999
        with self.assertRaisesRegex(ValueError, "do not sum"):
            self.sample({"epoch": 2, "slot": 1201}, {"epoch": 2, "slot": 1202}, snapshot=invalid)
        self.assertFalse(self.history.path.exists())
        for total, pools in [(1, [(POOL_A, -1)]), (1, [("not-a-pool", 1)]),
                             (2, [(POOL_A, 1), (POOL_A.upper(), 1)])]:
            with self.subTest(pools=pools), self.assertRaises(ValueError):
                normalize_stake(total, pools)

    def test_conflicting_same_epoch_snapshot_is_not_overwritten(self):
        self.sample({"epoch": 2, "slot": 1201}, {"epoch": 2, "slot": 1202})
        saved = json.loads(self.history.path.read_text())
        with self.assertRaisesRegex(ValueError, "Conflicting nonce or active stake"):
            self.sample({"epoch": 2, "slot": 1301}, {"epoch": 2, "slot": 1302}, snapshot=raw_stake(500, 500))
        self.assertEqual(json.loads(self.history.path.read_text())["stakes"], saved["stakes"])
        self.assertEqual(self.history.response(2, stake=True)[0], 503)
        with self.assertRaisesRegex(ValueError, "Conflicting nonce or active stake"):
            self.sample({"epoch": 2, "slot": 1301}, {"epoch": 2, "slot": 1302}, "cd" * 32)
        restarted = NonceHistory(self.history.path)
        restarted.record(self.history.genesis, 3, "ef" * 32)
        self.assertEqual(restarted.response(2, stake=True)[0], 404)
        self.assertEqual(restarted.response(2)[0], 404)

    def test_nonce_only_history_does_not_invent_old_stake_snapshots(self):
        self.history.path.write_text(json.dumps({"version": 1, "genesis": "chain", "nonces": {"1": "ab" * 32}}))
        restarted = NonceHistory(self.history.path)
        restarted.record("chain", 2, "cd" * 32, attach_vrf_keys(
            normalize_stake(400, [(POOL_A, 300), (POOL_B, 100)]),
            {POOL_A: {"vrf": VRF_A}, POOL_B: {"vrf": VRF_B}}))
        self.assertEqual(restarted.response(1)[0], 200)
        self.assertEqual(restarted.response(1, stake=True)[0], 404)
        self.assertEqual(restarted.response(2, stake=True)[1]["total_active_stake"], "400")

    def test_frozen_vrf_changes_only_in_the_observed_epoch_and_survives_restart(self):
        self.sample({"epoch": 2, "slot": 1201}, {"epoch": 2, "slot": 1202})
        self.sample({"epoch": 3, "slot": 1801}, {"epoch": 3, "slot": 1802}, "cd" * 32,
                    ledger=raw_ledger(3, first="56" * 32))
        restarted = NonceHistory(self.history.path)
        restarted.record(self.history.genesis, 4, "ef" * 32)
        # The newer Mark key never replaces the frozen Set key.
        self.assertEqual(restarted.response(2, stake=True)[1]["pools"][0]["vrf_key_hash"], VRF_A)
        self.assertEqual(restarted.response(3, stake=True)[1]["pools"][0]["vrf_key_hash"], "56" * 32)

    def test_missing_frozen_vrf_or_different_ledger_epoch_is_not_persisted(self):
        for ledger in (raw_ledger(2, first=None), raw_ledger(2, first="invalid"), raw_ledger(3)):
            with self.subTest(ledger=ledger), self.assertRaises(ValueError):
                self.sample({"epoch": 2, "slot": 1201}, {"epoch": 2, "slot": 1202}, ledger=ledger)
            self.assertFalse(self.history.path.exists())

    def test_same_epoch_vrf_conflict_is_quarantined(self):
        self.sample({"epoch": 2, "slot": 1201}, {"epoch": 2, "slot": 1202})
        with self.assertRaisesRegex(ValueError, "Conflicting nonce or active stake"):
            self.sample({"epoch": 2, "slot": 1301}, {"epoch": 2, "slot": 1302},
                        ledger=raw_ledger(2, first="56" * 32))
        self.history.record(self.history.genesis, 3, "cd" * 32)
        self.assertEqual(self.history.response(2, stake=True)[0], 404)

    def test_old_stake_history_retains_nonces_without_inventing_historical_vrfs(self):
        self.history.path.write_text(json.dumps({"version": 2, "genesis": "chain",
            "nonces": {"1": "ab" * 32, "2": "cd" * 32},
            "stakes": {"1": normalize_stake(400, [(POOL_A, 300), (POOL_B, 100)]),
                       "2": normalize_stake(400, [(POOL_A, 300), (POOL_B, 100)])}}))
        restarted = NonceHistory(self.history.path)
        restarted.record("chain", 2, "cd" * 32, attach_vrf_keys(
            normalize_stake(400, [(POOL_A, 300), (POOL_B, 100)]),
            {POOL_A: {"vrf": VRF_A}, POOL_B: {"vrf": VRF_B}}))
        self.assertEqual(restarted.response(1)[0], 200)
        self.assertEqual(restarted.response(1, stake=True)[0], 404)
        self.assertEqual(restarted.response(2, stake=True)[1]["pools"][0]["vrf_key_hash"], VRF_A)
        self.assertEqual(json.loads(self.history.path.read_text())["version"], 3)

    def test_http_returns_only_the_requested_observed_epoch(self):
        self.sample({"epoch": 2, "slot": 1201}, {"epoch": 2, "slot": 1202})
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.history))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            endpoint = f"http://127.0.0.1:{server.server_port}"
            with urlopen(endpoint + "/epoch_params?_epoch_no=2") as response:
                self.assertEqual(json.load(response), [{"epoch_no": 2, "nonce": "ab" * 32}])
            with urlopen(endpoint + "/health") as response:
                self.assertEqual(json.load(response)["epoch"], 2)
            with urlopen(endpoint + "/epoch_stake?_epoch_no=2") as response:
                body = json.load(response)
                self.assertEqual(body["epoch_no"], 2)
                self.assertEqual(body["total_active_stake"], "400")
                self.assertEqual(body["pools"][0], stake_row(POOL_A, 300, VRF_A))
            for path, status in [("/epoch_params?_epoch_no=1", 404),
                                 ("/epoch_stake?_epoch_no=1", 404),
                                 ("/epoch_stake?_epoch_no=2&_epoch_no=3", 400),
                                 ("/epoch_params?_epoch_no=2&_epoch_no=3", 400),
                                 ("/epoch_params?_epoch_no=-1", 400),
                                 ("/epoch_params", 400)]:
                with self.subTest(path=path), self.assertRaises(HTTPError) as failure:
                    urlopen(endpoint + path)
                self.assertEqual(failure.exception.code, status)
                failure.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
