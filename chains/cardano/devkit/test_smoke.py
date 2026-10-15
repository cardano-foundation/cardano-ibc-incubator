import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from smoke import indexed_block_window, raw_block_cbor, verify_genesis_security, verify_ledger_retention, verify_mithril


class IndexedBlockWindowTests(unittest.TestCase):
    def test_waits_until_genesis_is_outside_the_required_proof_window(self):
        early = [{"number": number, "cbor_bytes": 100 if number >= 0 else None}
                 for number in range(23, -2, -1)]
        ready = [{"number": number, "cbor_bytes": 100} for number in range(24, -1, -1)]
        runtime = Mock()
        runtime.sql.side_effect = ["null", json.dumps(early), json.dumps(ready)]
        with patch("profile.time.sleep") as sleep:
            self.assertEqual(indexed_block_window(runtime, 24), ready)
        self.assertEqual(sleep.call_count, 2)

    def test_missing_cbor_for_a_real_block_still_fails(self):
        runtime = Mock()
        runtime.sql.return_value = json.dumps([
            {"number": 3, "cbor_bytes": 100}, {"number": 2, "cbor_bytes": None},
            {"number": 1, "cbor_bytes": 100},
        ])
        with self.assertRaisesRegex(RuntimeError, "missing raw block CBOR"):
            indexed_block_window(runtime, 2)



class MithrilTests(unittest.TestCase):
    running = "mithril-aggregator running\nmithril-signer-2 running\nmithril-signer-3 running\n"

    def runtime(self, epoch, containers=running):
        runtime = Mock()
        runtime.compose.return_value = containers
        runtime.cli.return_value = json.dumps({"epoch": epoch})
        runtime.mithril_endpoint.return_value = "http://aggregator"
        return runtime

    def test_a_new_network_only_needs_running_containers(self):
        with patch("smoke.http") as http:
            result = verify_mithril(self.runtime(0))
        http.assert_not_called()
        self.assertEqual(result["epoch"], 0)
        self.assertNotIn("registered_signers", result)

    def test_a_restarting_signer_fails(self):
        containers = self.running.replace("mithril-signer-3 running", "mithril-signer-3 restarting")
        with self.assertRaisesRegex(RuntimeError, "mithril-signer-3 is restarting"):
            verify_mithril(self.runtime(0, containers))

    def test_signing_epochs_need_registrations_and_a_genesis_certificate(self):
        responses = {"http://aggregator/signers/registered/latest": {"registrations": [{}, {}]},
                     "http://aggregator/certificates": []}
        with patch("smoke.http", side_effect=responses.get):
            self.assertEqual(verify_mithril(self.runtime(2))["registered_signers"], 2)
            with self.assertRaisesRegex(RuntimeError, "no genesis certificate"):
                verify_mithril(self.runtime(3))
            responses["http://aggregator/certificates"] = [{"hash": "genesis"}]
            self.assertEqual(verify_mithril(self.runtime(3))["certificates"], 1)


class LedgerRetentionTests(unittest.TestCase):
    def test_exported_byron_and_shelley_both_require_the_full_query_window(self):
        for byron, shelley in ((10, 48), (48, 10), (10, 10)):
            with self.subTest(byron=byron, shelley=shelley), self.assertRaisesRegex(RuntimeError, "both be 48"):
                verify_genesis_security({"byron": {"protocolConsts": {"k": byron}},
                                         "shelley": {"securityParam": shelley}})
        verify_genesis_security({"byron": {"protocolConsts": {"k": 48}}, "shelley": {"securityParam": 48}})

    def test_queries_the_exact_anchor_after_24_descendants_and_rejects_a_newer_point(self):
        rows = [{"number": number, "slot": number * 4, "hash": f"{number:064x}"}
                for number in range(124, 99, -1)]
        point = {"slot": 400, "id": f"{100:064x}"}
        runtime = Mock()
        counters = {"pool1example": 0}
        runtime.ogmios.return_value = {"acquisition": {"acquired": "ledgerState", "point": point}, "query": counters}
        self.assertEqual(verify_ledger_retention(runtime, rows, 24), {
            "block_number": 100, "descendants": 24, "point": point, "operational_certificate_counters": counters,
        })
        runtime.ogmios.assert_called_once_with("acquireLedgerState", {"point": point},
                                               follow_up="queryLedgerState/operationalCertificates")
        runtime.ogmios.return_value = {"acquisition": {"acquired": "ledgerState", "point": {
            "slot": rows[0]["slot"], "id": rows[0]["hash"],
        }}, "query": counters}
        with self.assertRaisesRegex(RuntimeError, "exact block"):
            verify_ledger_retention(runtime, rows, 24)
        runtime.ogmios.side_effect = RuntimeError("Target point is too old")
        with self.assertRaisesRegex(RuntimeError, "too old"):
            verify_ledger_retention(runtime, rows, 24)

    def test_requires_operational_certificate_counters_from_the_acquired_connection(self):
        row = {"number": 1, "slot": 4, "hash": "11" * 32}
        runtime = Mock()
        for value in ({}, [], {"pool1example": -1}, {"pool1example": True}):
            runtime.ogmios.return_value = {"acquisition": {
                "acquired": "ledgerState", "point": {"slot": row["slot"], "id": row["hash"]},
            }, "query": value}
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, "certificate counters"):
                verify_ledger_retention(runtime, [row], 0)


class BlockCborBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[3]
        fixture = root / "cosmos/cardano-probabilistic-light-client-core/testdata/conway_block.hex"
        cls.block = "".join(fixture.read_text().split())

    def test_yaci_conway_envelope_preserves_exact_signed_block(self):
        # The live Yaci epoch-6 rows use this [7, rawBlock] prefix.
        self.assertEqual(raw_block_cbor("8207" + self.block), self.block)

    def test_raw_native_fixture_is_unchanged(self):
        self.assertEqual(raw_block_cbor(self.block), self.block)

    def test_unsupported_and_incomplete_wrappers_are_left_for_the_decoder(self):
        for value in ("82", "8207", "821818" + self.block, "8307" + self.block):
            with self.subTest(prefix=value[:6]):
                self.assertEqual(raw_block_cbor(value), value)


if __name__ == "__main__":
    unittest.main()
