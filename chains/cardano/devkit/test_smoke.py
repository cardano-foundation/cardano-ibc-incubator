from pathlib import Path
import unittest

from smoke import raw_block_cbor


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
