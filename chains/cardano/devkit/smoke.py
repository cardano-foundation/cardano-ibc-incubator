"""Verify transactions and native block evidence from all five DevKit producers."""

import json
import re
import socket
import subprocess

from profile import http, normalized_genesis, wait_for


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def stability_requirements(root):
    policy = (root / "cardano/gateway/src/query/services/stability-scoring.ts").read_text()
    result = {}
    for key in ("threshold_depth", "threshold_unique_pools"):
        match = re.search(rf"{key}:\s*(\d+)n", policy)
        require(match is not None, f"Cannot read the Gateway stability policy: {key}")
        result[key] = int(match.group(1))
    return result


def verify_genesis_security(genesis):
    require(genesis["byron"].get("protocolConsts", {}).get("k") ==
            genesis["shelley"].get("securityParam") == 48,
            "Byron k and Shelley securityParam must both be 48 for retained ledger queries")


def indexed_block_window(runtime, depth):
    def sample():
        rows = json.loads(runtime.sql(
            "SELECT json_agg(row_to_json(sample)) FROM (SELECT b.number, b.hash, b.prev_hash, b.slot, "
            "b.slot_leader, octet_length(c.cbor_data) AS cbor_bytes "
            "FROM block b LEFT JOIN block_cbor c ON c.block_hash = b.hash "
            f"ORDER BY b.number DESC LIMIT {depth + 1}) sample")) or []
        # Yaci's genesis record has no signed block bytes and cannot anchor a proof.
        if len(rows) != depth + 1 or rows[-1]["number"] < 0:
            return None
        return rows

    rows = wait_for("indexed block descendants", sample)
    require(all(row["cbor_bytes"] and row["cbor_bytes"] > 0 for row in rows), "Yaci is missing raw block CBOR")
    return rows


def verify_ledger_retention(runtime, rows, depth):
    require(len(rows) == depth + 1 and rows[0]["number"] - rows[-1]["number"] == depth,
            "Missing indexed descendants for the retained ledger query")
    point = {"slot": rows[-1]["slot"], "id": rows[-1]["hash"]}
    response = runtime.ogmios("acquireLedgerState", {"point": point},
                              follow_up="queryLedgerState/operationalCertificates")
    acquired = response["acquisition"]
    require(acquired.get("acquired") == "ledgerState" and acquired.get("point") == point,
            "Ogmios did not acquire the exact block at the required stability depth")
    counters = response["query"]
    require(isinstance(counters, dict) and bool(counters) and
            all(isinstance(value, int) and not isinstance(value, bool) and value >= 0
                for value in counters.values()), "Missing operational certificate counters at the acquired block")
    return {"block_number": rows[-1]["number"], "descendants": depth, "point": point,
            "operational_certificate_counters": counters}


def submit_payment(runtime):
    # Keys stay inside the disposable container and are never logged/exported.
    path = "/tmp/caribic-devkit-test"
    runtime.compose("exec", "-T", "devkit", "mkdir", "-p", path)
    try:
        runtime.cli("address", "key-gen", "--verification-key-file", path + "/payment.vkey",
                    "--signing-key-file", path + "/payment.skey")
        address = runtime.cli("address", "build", "--payment-verification-key-file",
                              path + "/payment.vkey", "--testnet-magic", "42")
        runtime.fund(address, 10_000_000)
        utxos = wait_for("faucet transaction inclusion", lambda:
                        json.loads(runtime.cli("query", "utxo", "--address", address,
                                               "--testnet-magic", "42", "--output-json")))
        tx_in = next(iter(utxos))
        runtime.cli("conway", "transaction", "build", "--testnet-magic", "42", "--tx-in", tx_in,
                    "--tx-out", address + "+2000000", "--change-address", address,
                    "--out-file", path + "/tx.body")
        runtime.cli("conway", "transaction", "sign", "--tx-body-file", path + "/tx.body",
                    "--signing-key-file", path + "/payment.skey", "--out-file", path + "/tx.signed")
        signed = json.loads(runtime.compose("exec", "-T", "devkit", "cat", path + "/tx.signed", capture=True))
        tx_id = runtime.cli("conway", "transaction", "txid", "--tx-file", path + "/tx.signed", "--output-text")
        require(re.fullmatch(r"[0-9a-f]{64}", tx_id), "Invalid transaction ID from cardano-cli")
        submitted = runtime.ogmios("submitTransaction", {"transaction": {"cbor": signed["cborHex"]}})
        require(submitted.get("transaction", {}).get("id") == tx_id, "Ogmios returned a different transaction ID")
        matches = wait_for("payment in Kupo", lambda:
                           [row for row in http(runtime.endpoint("DEVKIT_KUPO_PORT") + "/matches/" + address)
                            if row["transaction_id"] == tx_id])
        require(any(row["value"]["coins"] == 2000000 for row in matches), "Kupo did not return the payment output")
        wait_for("payment CBOR in Yaci history", lambda:
                 runtime.sql(f"SELECT octet_length(cbor_data) FROM transaction_cbor WHERE tx_hash = '{tx_id}'"))
        return {"transaction_id": tx_id, "lovelace": 2000000,
                "ogmios_submission": True, "kupo_inclusion": True, "yaci_transaction_cbor": True}
    finally:
        runtime.compose("exec", "-T", "devkit", "rm", "-rf", path)


def raw_block_cbor(indexed_hex):
    # Match Gateway's normalizeYaciBlockCbor: Yaci can retain the
    # [blockType, rawBlockCbor] envelope around the signed block.
    encoded = bytes.fromhex(indexed_hex)
    if len(encoded) >= 3 and encoded[0] == 0x82 and encoded[1] <= 0x17:
        return encoded[2:].hex()
    return indexed_hex


def verify_producer_blocks(runtime, shelley):
    binary = runtime.state / "verify-blocks"
    # Reuse the existing verifier as a read-only dependency of this DevKit tool.
    source = runtime.root / "chains/cardano/devkit/verify-blocks/main.go"
    subprocess.run(["go", "build", "-mod=readonly", "-o", str(binary), str(source)],
                   cwd=runtime.root / "cosmos/cardano-probabilistic-light-client-core", check=True)

    window_size = stability_requirements(runtime.root)["threshold_depth"] + 1

    def sample():
        tip = json.loads(runtime.cli("query", "tip", "--testnet-magic", "42"))
        epoch = tip["epoch"]
        snapshot = json.loads(runtime.cli("query", "stake-snapshot", "--all-stake-pools", "--testnet-magic", "42"))
        name = "stakeMark" if epoch == 0 else "stakeSet"
        stakes = {pool: value[name] for pool, value in snapshot["pools"].items() if value[name] > 0}
        total = snapshot["total"][name]
        require(len(stakes) == 5 and sum(stakes.values()) == total, "Expected five active stakes")
        rows = json.loads(runtime.sql(
            "SELECT json_agg(row_to_json(sample)) FROM (SELECT "
            "b.slot_leader, b.number, b.hash, b.prev_hash, b.slot, encode(c.cbor_data, 'hex') AS cbor "
            "FROM block b JOIN block_cbor c ON c.block_hash = b.hash "
            f"WHERE b.epoch = {epoch} ORDER BY b.number DESC LIMIT {window_size}) sample")) or []
        if len(rows) != window_size or {row["slot_leader"] for row in rows} != set(stakes):
            return None
        for newer, older in zip(rows, rows[1:]):
            require(newer["number"] == older["number"] + 1 and newer["prev_hash"] == older["hash"],
                    "Native verification window is not contiguous")
        endpoint = runtime.endpoint("DEVKIT_NONCE_PORT")
        nonce = http(f"{endpoint}/epochs/{epoch}/parameters")["nonce"]
        observed = http(f"{endpoint}/epoch_stake?_epoch_no={epoch}")
        require(int(observed["total_active_stake"]) == total and
                {pool["pool_id_hex"]: int(pool["active_stake"]) for pool in observed["pools"]} == stakes,
                "Epoch history does not match the native active snapshot")
        vrf_keys = {pool["pool_id_hex"]: pool["vrf_key_hash"] for pool in observed["pools"]}
        require(all(re.fullmatch(r"[0-9a-f]{64}", key) for key in vrf_keys.values()),
                "Epoch history is missing the registered VRF key hashes")
        if json.loads(runtime.cli("query", "tip", "--testnet-magic", "42"))["epoch"] != epoch:
            return None
        return epoch, nonce, stakes, total, vrf_keys, rows

    epoch, nonce, stakes, total, vrf_keys, rows = wait_for("a stability window with all five producers in the current epoch", sample, timeout=600)
    request = {
        "slots_per_kes_period": shelley["slotsPerKESPeriod"],
        "max_kes_evolutions": shelley["maxKESEvolutions"],
        "active_slot_numerator": 1, "active_slot_denominator": 4,
        "blocks": [{"block_cbor": raw_block_cbor(row["cbor"]), "epoch_nonce": nonce,
                    "stake_numerator": stakes[row["slot_leader"]], "stake_denominator": total} for row in rows],
    }
    result = subprocess.run([str(binary)], input=json.dumps(request), text=True, capture_output=True)
    require(result.returncode == 0, f"Native block verification failed: {result.stderr.strip()}")
    verified = json.loads(result.stdout)
    require(verified["verified_blocks"] == window_size, "Not all stability window blocks were cryptographically verified")
    metadata = verified["blocks"]
    require(len(metadata) == len(rows), "Native verification omitted block metadata")
    for actual, row in zip(metadata, rows):
        require(actual == {"block_hash": row["hash"], "block_number": row["number"],
                           "slot": row["slot"], "pool_id_hex": row["slot_leader"],
                           "vrf_key_hash": vrf_keys[row["slot_leader"]]},
                "Authenticated block header differs from the indexed metadata or registered VRF key")
    require({block["pool_id_hex"] for block in metadata} == set(stakes),
            "Authenticated headers do not contain all five active producers")
    return {"epoch": epoch, "verified_producers": sorted(stakes), "verified_blocks": window_size,
            "epoch_nonce": nonce, "active_stake": total, "blocks": metadata}


def run_smoke(runtime):
    genesis = json.loads((runtime.state / "genesis.json").read_text())
    verify_genesis_security(genesis)
    shelley = genesis["shelley"]
    expected = {"networkMagic": 42, "slotLength": 1, "epochLength": 5000,
                "activeSlotsCoeff": 0.25, "securityParam": 48}
    for key, value in expected.items():
        require(shelley.get(key) == value, f"Unexpected genesis {key}: {shelley.get(key)}")
    require(shelley["protocolParams"]["protocolVersion"]["major"] == 10, "Expected protocol version 10")
    require(len(genesis["conway"]["plutusV3CostModel"]) >= 297,
            "Protocol version 10 requires the 297-entry PlutusV3 cost model")
    require(len(shelley["staking"]["pools"]) == 5, "Expected five genesis pools")
    require(bool(shelley["initialFunds"]), "Missing deterministic funded accounts")
    live_genesis = runtime.ogmios("queryNetwork/genesisConfiguration", {"era": "shelley"})
    require(live_genesis["networkMagic"] == 42, "Ogmios is connected to a different network")
    require(live_genesis["startTime"] == shelley["systemStart"], "Ogmios genesis differs from this profile")
    require(http(runtime.endpoint("DEVKIT_OGMIOS_PORT") + "/health")["currentEra"] == "conway",
            "The network has not reached Conway")
    protocol = runtime.ogmios("queryLedgerState/protocolParameters")
    for field, memory, cpu in (("maxExecutionUnitsPerTransaction", 16_500_000, 10_000_000_000),
                                ("maxExecutionUnitsPerBlock", 72_000_000, 20_000_000_000)):
        require(protocol[field] == {"memory": memory, "cpu": cpu},
                f"DevKit {field} differs from the pinned public-network limits")
    for field, value in (("maxTxSize", 16_384), ("maxBlockBodySize", 90_112), ("maxBlockHeaderSize", 1_100)):
        require(shelley["protocolParams"][field] == value, f"Unexpected genesis capacity: {field}")
    with socket.create_connection((runtime.settings["DEVKIT_HOST"], int(runtime.settings["DEVKIT_NODE_PORT"])), timeout=5):
        pass
    policy = stability_requirements(runtime.root)
    depth = policy["threshold_depth"]
    # Check consecutive history and retained block bytes, not just HTTP health.
    rows = indexed_block_window(runtime, depth)
    for newer, older in zip(rows, rows[1:]):
        require(newer["number"] == older["number"] + 1 and newer["prev_hash"] == older["hash"],
                "Yaci block history is not contiguous")
    producers = {row["slot_leader"] for row in rows}
    require(None not in producers and "" not in producers, "Missing block producer identity")
    intersection = runtime.ogmios("findIntersection", {"points": [{"slot": rows[0]["slot"], "id": rows[0]["hash"]}]})
    require(intersection["intersection"]["id"] == rows[0]["hash"], "Ogmios and Yaci disagree on the chain")
    retained = verify_ledger_retention(runtime, rows, depth)
    block = http(runtime.endpoint("DEVKIT_HISTORY_PORT") + "/api/v1/blocks/latest")
    for key in ("block_vrf", "issuer_vkey", "op_cert", "op_cert_sigma"):
        require(bool(block.get(key)), f"Missing Praos field in Yaci: {key}")
    require(bool(block.get("vrf_result", {}).get("proof")), "Missing VRF proof in Yaci")
    nonce = json.loads(runtime.cli("query", "protocol-state", "--testnet-magic", "42"))["epochNonce"]
    require(re.fullmatch(r"[0-9a-f]{64}", nonce), "Missing Cardano epoch nonce")
    verification = verify_producer_blocks(runtime, shelley)
    payment = submit_payment(runtime)
    return {
        "genesis_config_sha256": normalized_genesis(genesis),
        "genesis_parameters": expected, "genesis_pool_count": len(shelley["staking"]["pools"]),
        "funded_genesis_accounts": len(shelley["initialFunds"]),
        "payment": payment,
        "evidence": {"contiguous_blocks": len(rows), "raw_block_cbor": True,
                     "praos_fields_present": True, "epoch_nonce": nonce, "distinct_producers": len(producers),
                     "retained_ledger_state": retained},
        "native_verification": verification,
        "bridge_compatibility": {
            "status": "network_ready",
            "required_distinct_pools": policy["threshold_unique_pools"],
            "not_exercised_by_smoke_test": ["Bridge Projection",
                                           "IBC client, connection and channel handshakes", "ICS-20 transfer, acknowledgement, timeout and refund"],
        },
    }
