import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  applyDoubleCborEncoding,
  Constr,
  Data,
  fromText,
  getAddressDetails,
  Lucid,
  type Script,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import { loadStagedTendermintValidators } from "../src/deployment-plan.ts";
import { createCardanoScalusEvaluator } from "../src/scalus-evaluator.ts";
import { submitHistorySession } from "./consensus-history-staged-fixture.ts";
import fixture from "../../gateway/src/scripts/test/fixtures/tendermint-update-capacity/normalized.json" with {
  type: "json",
};
import parameters from "./fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};

const c = (fields: Data[]) => new Constr<Data>(0, fields);
const scenario = fixture.scenarios.non_adjacent_mixed;
const rawHeader = scenario.header.signed_header.header;
const rawCommit = scenario.header.signed_header.commit;
const blockId = (value: typeof rawHeader.last_block_id) =>
  c([
    value.hash,
    c([BigInt(value.part_set_header.total), value.part_set_header.hash]),
  ]);
const validator = (
  value: typeof scenario.header.validator_set.validators[number],
) =>
  c([
    value.address,
    value.pub_key.ed25519,
    BigInt(value.voting_power),
    BigInt(value.proposer_priority),
  ]);
const validatorSet = (value: typeof scenario.header.validator_set) =>
  c([
    value.validators.map(validator),
    validator(value.proposer),
    BigInt(value.total_voting_power),
  ]);
const header = c([
  c([
    c([
      c([BigInt(rawHeader.version.block), BigInt(rawHeader.version.app)]),
      fromText(rawHeader.chain_id),
      BigInt(rawHeader.height),
      BigInt(rawHeader.time),
      blockId(rawHeader.last_block_id),
      rawHeader.last_commit_hash,
      rawHeader.data_hash,
      rawHeader.validators_hash,
      rawHeader.next_validators_hash,
      rawHeader.consensus_hash,
      rawHeader.app_hash,
      rawHeader.last_results_hash,
      rawHeader.evidence_hash,
      rawHeader.proposer_address,
    ]),
    c([
      BigInt(rawCommit.height),
      BigInt(rawCommit.round),
      blockId(rawCommit.block_id),
      rawCommit.signatures.map((value) =>
        c([
          BigInt(value.block_id_flag),
          value.validator_address,
          BigInt(value.timestamp),
          value.signature,
        ])
      ),
    ]),
  ]),
  validatorSet(scenario.header.validator_set),
  c([1n, BigInt(scenario.header.trusted_height.revision_height)]),
  validatorSet(scenario.header.trusted_validators),
]);

async function verify(
  batchSize: number,
  quorumWitnesses = true,
  forceGeneral = false,
) {
  const account = generateEmulatorAccount({ lovelace: 1_000_000_000n });
  const emulator = new Emulator([account]);
  Object.assign(emulator.protocolParameters, {
    ...parameters,
    maxTxExMem: BigInt(parameters.maxTxExMem),
    maxTxExSteps: BigInt(parameters.maxTxExSteps),
    coinsPerUtxoByte: BigInt(parameters.coinsPerUtxoByte),
  });
  emulator.protocolParameters.costModels.PlutusV3 =
    parameters.plutusV3CostModel;
  const lucid = await Lucid(emulator, "Preprod", {
    evaluator: createCardanoScalusEvaluator(),
  });
  lucid.selectWallet.fromSeed(account.seedPhrase);
  const scripts = loadStagedTendermintValidators(
    lucid,
    "11".repeat(28),
    "22".repeat(28),
  );
  const references = [
    scripts.sessionSpend.validator,
    scripts.sessionMint.validator,
  ].map((script: Script, index) => {
    const utxo = {
      txHash: (index + 1).toString(16).padStart(64, "0"),
      outputIndex: 0,
      address: account.address,
      assets: { lovelace: 100_000_000n },
      datum: Data.void(),
      scriptRef: { ...script, script: applyDoubleCborEncoding(script.script) },
    };
    emulator.ledger[utxo.txHash + utxo.outputIndex] = { utxo, spent: false };
    return utxo;
  });
  const result = await submitHistorySession({
    lucid,
    emulator,
    scripts,
    references,
    header,
    batchSize,
    quorumWitnesses,
    forceGeneral,
    resourcePercent: 80,
    clientToken: c(["33".repeat(28), "44".repeat(32)]),
    trustedHeight: c([
      1n,
      BigInt(scenario.header.trusted_height.revision_height),
    ]),
    trustedConsensus: c([
      BigInt(scenario.trusted_consensus_state.timestamp),
      scenario.trusted_consensus_state.next_validators_hash,
      c([scenario.trusted_consensus_state.root]),
    ]),
    clientState: c([
      fromText(rawHeader.chain_id),
      c([1n, 3n]),
      1_209_600_000_000_000n,
      1_814_400_000_000_000n,
      10_000_000_000n,
    ]),
    owner: getAddressDetails(account.address).paymentCredential!.hash,
  });
  const complete = (Data.from(result.utxo.datum!) as Constr<Data>)
    .fields[3] as Constr<Data>;
  assertEquals(complete.index, 3);
  assertEquals(complete.fields[0], rawHeader.validators_hash);
  return { measurements: result.measurements, witnesses: result.witnesses };
}

Deno.test("45-validator signed sessions use fewer fees and retain 20 percent execution headroom", async () => {
  const baseline = await verify(6);
  const larger = await verify(24);
  assertEquals(baseline.measurements.length, 9);
  assertEquals(larger.measurements.length, 3);
  const fee = (values: typeof larger) =>
    values.measurements.reduce((sum, value) => sum + value.fee, 0);
  assert(fee(larger) < fee(baseline));
});

Deno.test("signed sessions reject a batch above the onchain limit", async () => {
  await assertRejects(
    () => verify(25),
    Error,
    "Failed signed session verify target",
  );
});

Deno.test("45-validator quorum witnesses lower signed session fees with unchanged contracts and batches", async () => {
  for (const forceGeneral of [false, true]) {
    const full = await verify(24, false, forceGeneral);
    const selected = await verify(24, true, forceGeneral);
    assertEquals(selected.measurements.length, full.measurements.length);
    assertEquals(full.witnesses, {
      signatures: 43,
      memberships: forceGeneral ? 43 : 0,
    });
    assertEquals(selected.witnesses, {
      signatures: 17,
      memberships: forceGeneral ? 6 : 0,
    });
    const fee = (value: typeof selected) =>
      value.measurements.reduce((sum, tx) => sum + tx.fee, 0);
    assert(fee(selected) < fee(full) * 0.95);
  }
});
