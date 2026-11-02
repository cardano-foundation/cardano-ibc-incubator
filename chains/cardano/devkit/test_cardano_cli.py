import io
import json
import os
import unittest
from unittest.mock import patch

from cardano_cli import BINARY, KES_ENDPOINT, certificate_args, main, query_kes_period


class CertificateTests(unittest.TestCase):
    def args(self, period):
        return ["node", "issue-op-cert", "--kes-period", str(period),
                "--cold-signing-key-file", "cold.skey", "--out-file", "opcert.cert"]

    def test_unavailable_peer_query_recovers_the_observed_period_before_launch(self):
        original = self.args(-1)
        with patch.dict(os.environ, {"DEVKIT_PEER": "true"}), \
                patch("cardano_cli.query_kes_period", side_effect=[-1, OSError("temporary tip query failure"), 7]) as query, \
                patch("cardano_cli.time.sleep"), patch("cardano_cli.os.execv") as launch:
            main(original)
        self.assertEqual(query.call_count, 3)
        launch.assert_called_once_with(BINARY, [BINARY, *self.args(7)])
        self.assertEqual(original, self.args(-1))

    def test_zero_is_used_only_after_the_admin_actually_returns_zero(self):
        with patch("cardano_cli.query_kes_period", side_effect=[-1, 0]) as query, \
                patch("cardano_cli.time.sleep"):
            self.assertEqual(certificate_args(self.args(-1), peer=True), self.args(0))
        self.assertEqual(query.call_count, 2)

    def test_unavailable_or_malformed_queries_never_launch_certificate_issuance(self):
        for response in [-1, None, True, 1.5, "0", OSError("unavailable"), ValueError("bad JSON")]:
            with self.subTest(response=response):
                elapsed = [0]

                def sleep(seconds):
                    elapsed[0] += seconds

                with patch.dict(os.environ, {"DEVKIT_PEER": "true"}), \
                        patch("cardano_cli.query_kes_period", side_effect=[response] * 30), \
                        patch("cardano_cli.time.monotonic", side_effect=lambda: elapsed[0]), \
                        patch("cardano_cli.time.sleep", side_effect=sleep), \
                        patch("cardano_cli.os.execv") as launch:
                    with self.assertRaisesRegex(RuntimeError, "did not recover before certificate issuance"):
                        main(self.args(-1))
                    launch.assert_not_called()

    def test_valid_periods_and_other_commands_pass_through_without_querying(self):
        for args, peer in [(self.args(0), True), (self.args(73), True),
                           (self.args(-1), False), (self.args(-2), True),
                           (["--version"], True), (["query", "tip"], True),
                           (["node", "issue-op-cert", "--kes-period"], True)]:
            with self.subTest(args=args, peer=peer), patch("cardano_cli.query_kes_period") as query:
                self.assertEqual(certificate_args(args, peer), args)
                query.assert_not_called()

    def test_query_uses_the_same_admin_endpoint_as_native_join(self):
        response = io.BytesIO(json.dumps(4).encode())
        with patch("cardano_cli.urllib.request.urlopen", return_value=response) as request:
            self.assertEqual(query_kes_period(), 4)
        request.assert_called_once_with(KES_ENDPOINT, timeout=5)


if __name__ == "__main__":
    unittest.main()
