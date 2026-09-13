from pathlib import Path
import unittest
from unittest.mock import Mock

from smoke import raw_block_cbor, verify_genesis_security, verify_ledger_retention


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
        runtime.ogmios.return_value = {"acquired": "ledgerState", "point": point}
        self.assertEqual(verify_ledger_retention(runtime, rows, 24), {
            "block_number": 100, "descendants": 24, "point": point,
        })
        runtime.ogmios.assert_called_once_with("acquireLedgerState", {"point": point})
        runtime.ogmios.return_value = {"acquired": "ledgerState", "point": {
            "slot": rows[0]["slot"], "id": rows[0]["hash"],
        }}
        with self.assertRaisesRegex(RuntimeError, "exact block"):
            verify_ledger_retention(runtime, rows, 24)
        runtime.ogmios.side_effect = RuntimeError("Target point is too old")
        with self.assertRaisesRegex(RuntimeError, "too old"):
            verify_ledger_retention(runtime, rows, 24)


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
