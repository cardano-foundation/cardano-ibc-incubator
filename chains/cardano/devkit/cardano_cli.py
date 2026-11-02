"""Recover an unavailable DevKit KES query before issuing a peer certificate."""

import json
import os
import sys
import time
import urllib.request


BINARY = "/app/cardano-bin/cardano-cli.bin"
KES_ENDPOINT = "http://devkit.local:10000/local-cluster/api/admin/devnet/kes-period"


def query_kes_period():
    with urllib.request.urlopen(KES_ENDPOINT, timeout=5) as response:
        return json.load(response)


def certificate_args(args, peer):
    if not peer or args[:2] != ["node", "issue-op-cert"] or "--kes-period" not in args:
        return args
    index = args.index("--kes-period") + 1
    if index == len(args) or args[index] != "-1":
        return args

    # The pinned DevKit returns -1 when its local-state tip query fails.
    # Ask it again, rather than treating that sentinel as period zero.
    print("DevKit KES query unavailable, retrying before certificate issuance", file=sys.stderr)
    deadline = time.monotonic() + 30
    last_error = "no nonnegative period returned"
    while time.monotonic() < deadline:
        try:
            period = query_kes_period()
            if type(period) is int and period >= 0:
                updated = list(args)
                updated[index] = str(period)
                print(f"DevKit KES query recovered: {period}", file=sys.stderr)
                return updated
            last_error = f"invalid KES period: {period!r}"
        except (OSError, ValueError) as error:
            last_error = str(error)
        time.sleep(1)
    raise RuntimeError(f"DevKit KES query did not recover before certificate issuance: {last_error}")


def main(args):
    updated = certificate_args(args, os.environ.get("DEVKIT_PEER") == "true")
    os.execv(BINARY, [BINARY, *updated])


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except RuntimeError as error:
        print(error, file=sys.stderr)
        sys.exit(2)
