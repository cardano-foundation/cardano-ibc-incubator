import {
  CML,
  type UTxO,
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import type { PacketLaneDeployment } from "../packet-lane-transactions.ts";

// Set PACKET_CONSOLIDATION_EVIDENCE and run the fragmented-backing test with
// --allow-write to regenerate the companion Hermes signing fixture.
export async function writeConsolidationEvidence(path: string, data: {
  deployment: PacketLaneDeployment;
  hostPolicy: string;
  signer: string;
  cbor: string;
  regular: UTxO[];
  collateral: UTxO[];
}) {
  const base = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../relayer/crates/relayer/src/chain/cardano/fixtures/packet-lane-signing.json",
        import.meta.url,
      ),
    ),
  );
  const d = data.deployment;
  const script = (input: UTxO, hash?: string) => ({
    script_hash: hash ?? validatorToScriptHash(input.scriptRef!),
    address: validatorToAddress("Custom", input.scriptRef!),
    ref_utxo: { tx_hash: input.txHash, output_index: input.outputIndex },
  });
  const m = base.manifest;
  m.host_state_nft.policy_id = data.hostPolicy;
  m.validators.mint_channel_stt.script_hash = Object.keys(d.channel.assets)
    .find((k) => k !== "lovelace")!.slice(0, 56);
  m.packet_state.batch = script(d.scripts[0], d.batchPolicy);
  m.packet_state.guard = script(d.scripts[1]);
  m.packet_state.state = script(d.scripts[2], d.statePolicy);
  m.packet_state.operations = Object.fromEntries(
    Object.entries(d.operations).map((
      [name, op],
    ) => [name, script(op.reference, op.policy)]),
  );
  const project = (input: UTxO) => ({
    txHash: input.txHash,
    outputIndex: input.outputIndex,
    address: CML.Address.from_bech32(input.address).to_hex(),
    lovelace: Number(input.assets.lovelace),
    datum: input.datum,
    assets: Object.entries(input.assets).filter(([unit]) => unit !== "lovelace")
      .map(([unit, quantity]) => ({
        policy: unit.slice(0, 56),
        name: unit.slice(56),
        quantity: Number(quantity),
      })),
  });
  const row = {
    name: "consolidate",
    cbor: data.cbor,
    regular: data.regular.map(project),
    collateral: data.collateral.map(project),
  };
  await Deno.writeTextFile(
    path,
    JSON.stringify(
      {
        provenance:
          "Compiled five-deposit consolidation from packet-lane-transactions.test.ts. Unused manifest roots retained from packet-lane-signing.json.",
        manifest: m,
        signer: data.signer,
        cases: [row],
      },
      (_key, value) => typeof value === "bigint" ? value.toString() : value,
      2,
    ) + "\n",
  );
}
