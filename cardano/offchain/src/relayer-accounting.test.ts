import { assertEquals, assertThrows } from "@std/assert";
import { CML, credentialToAddress, type UTxO } from "@lucid-evolution/lucid";
import {
  type CostProfile,
  measureTransaction,
  projectFunding,
} from "./relayer-accounting.ts";

const payer = credentialToAddress("Custom", {
  type: "Key",
  hash: "aa".repeat(28),
});
const script = credentialToAddress("Custom", {
  type: "Script",
  hash: "bb".repeat(28),
});
const recipient = credentialToAddress("Custom", {
  type: "Key",
  hash: "cc".repeat(28),
});
const coin = 4310n;
const utxo = (hash: string, address: string, lovelace: bigint): UTxO => ({
  txHash: hash.repeat(32),
  outputIndex: 0,
  address,
  assets: { lovelace },
});
function fixture(extraState = 0n, valid = true) {
  const inputs = [
    utxo("01", payer, 10_000_000n),
    utxo("02", script, 4_000_000n),
  ];
  const collateral = [utxo("03", payer, 5_000_000n)];
  const refs = (values: UTxO[]) => {
    const list = CML.TransactionInputList.new();
    values.forEach((u) =>
      list.add(
        CML.TransactionInput.new(
          CML.TransactionHash.from_hex(u.txHash),
          BigInt(u.outputIndex),
        ),
      )
    );
    return list;
  };
  const outputs = CML.TransactionOutputList.new();
  const add = (address: string, value: bigint) =>
    outputs.add(
      CML.TransactionOutput.new(
        CML.Address.from_bech32(address),
        CML.Value.from_coin(value),
      ),
    );
  add(payer, 8_000_000n);
  add(script, 4_000_000n + extraState);
  add(recipient, 1_800_000n - extraState);
  const body = CML.TransactionBody.new(refs(inputs), outputs, 200_000n);
  body.set_collateral_inputs(refs(collateral));
  body.set_total_collateral(400_000n);
  body.set_collateral_return(
    CML.TransactionOutput.new(
      CML.Address.from_bech32(payer),
      CML.Value.from_coin(4_600_000n),
    ),
  );
  const tx = CML.Transaction.new(body, CML.TransactionWitnessSet.new(), valid);
  const classify = (u: UTxO) => ({
    name: u.address === payer
      ? "payer"
      : u.address === script
      ? "state"
      : "recipient",
    wallet: u.address === payer,
    controller: "test authority",
    recoveryRecipient: "test authority",
    recoveryCondition: "explicit test policy",
    principalLovelace: u.address === script ? 2_000_000n : 0n,
  });
  return { inputs, collateral, tx, classify };
}

Deno.test("recreated state and successful collateral are not new expenses", () => {
  const f = fixture();
  const report = measureTransaction(
    f.tx.to_cbor_hex(),
    f.inputs,
    f.collateral,
    coin,
    f.classify,
  );
  assertEquals(report.feeLovelace, 200_000n);
  assertEquals(report.roles.payer.netDebitLovelace, 2_000_000n);
  assertEquals(report.roles.state.netReserveIncreaseLovelace, 0n);
  assertEquals(report.roles.state.netPrincipalIncreaseLovelace, 0n);
  assertEquals(report.roles.recipient.netDebitLovelace, -1_800_000n);
  assertEquals(report.collateral.reservedLovelace, 5_000_000n);
  assertEquals(report.collateral.consumedLovelace, 0n);
  assertEquals(report.outputLovelace, 13_800_000n);
  assertEquals(report.reconciliationDifferenceLovelace, 0n);
});

Deno.test("only the change in state reserves counts as new capital", () => {
  const f = fixture(100_000n);
  const report = measureTransaction(
    f.tx.to_cbor_hex(),
    f.inputs,
    f.collateral,
    coin,
    f.classify,
  );
  assertEquals(report.roles.state.netReserveIncreaseLovelace, 100_000n);
  assertEquals(report.roles.recipient.outputLovelace, 1_700_000n);
  assertEquals(
    report.roles.payer.netDebitLovelace,
    report.feeLovelace + report.roles.state.netReserveIncreaseLovelace +
      report.roles.recipient.outputLovelace,
  );
});

Deno.test("missing, duplicate, surplus and wrong resolved inputs cannot produce a cost report", () => {
  const f = fixture();
  for (
    const inputs of [[], f.inputs.slice(1), [f.inputs[0], f.inputs[0]], [
      ...f.inputs,
      ...f.collateral,
    ], [f.inputs[0], { ...f.inputs[1], txHash: "ff".repeat(32) }]]
  ) {
    assertThrows(() =>
      measureTransaction(
        f.tx.to_cbor_hex(),
        inputs,
        f.collateral,
        coin,
        f.classify,
      )
    );
  }
  assertThrows(() =>
    measureTransaction(f.tx.to_cbor_hex(), f.inputs, [], coin, f.classify)
  );
});

Deno.test("non-UTxO value flows and failed-script transactions require separate accounting", () => {
  const f = fixture();
  const incorrect = f.inputs.map((u) => ({
    ...u,
    assets: { lovelace: u.assets.lovelace + 1n },
  }));
  assertThrows(
    () =>
      measureTransaction(
        f.tx.to_cbor_hex(),
        incorrect,
        f.collateral,
        coin,
        f.classify,
      ),
    Error,
    "does not reconcile",
  );
  const failed = fixture(0n, false);
  assertThrows(
    () =>
      measureTransaction(
        failed.tx.to_cbor_hex(),
        failed.inputs,
        failed.collateral,
        coin,
        failed.classify,
      ),
    Error,
    "Failed-script collateral",
  );
});

Deno.test("below-minimum outputs and invalid principal allocations are rejected", () => {
  const f = fixture(1_799_999n);
  assertThrows(
    () =>
      measureTransaction(
        f.tx.to_cbor_hex(),
        f.inputs,
        f.collateral,
        coin,
        f.classify,
      ),
    Error,
    "minimum ADA",
  );
  const valid = fixture();
  assertThrows(
    () =>
      measureTransaction(
        valid.tx.to_cbor_hex(),
        valid.inputs,
        valid.collateral,
        coin,
        (u) => ({
          ...valid.classify(u),
          principalLovelace: u.assets.lovelace + 1n,
        }),
      ),
    Error,
    "principal allocation",
  );
});

const profile: CostProfile = {
  name: "receive",
  relayerNetDebitLovelace: 2_000_000n,
  relayerFeesLovelace: 300_000n,
  recipientTopUpLovelace: 1_500_000n,
  protocolReserveIncreaseLovelace: 200_000n,
  collateralLovelace: 5_000_000n,
};
const options = {
  days: 3,
  concurrency: 4,
  spendableReserveLovelace: 10_000_000n,
};
Deno.test("funding projection keeps fees, recipient ADA, protocol capital and collateral separate", () => {
  const report = projectFunding([profile], { receive: 1000 }, options);
  assertEquals(report.dailyRelayerNetDebitLovelace, 2_000_000_000n);
  assertEquals(report.dailyRelayerFeesLovelace, 300_000_000n);
  assertEquals(report.dailyRecipientTopUpLovelace, 1_500_000_000n);
  assertEquals(report.dailyProtocolReserveIncreaseLovelace, 200_000_000n);
  assertEquals(report.netFundingConsumedLovelace, 6_000_000_000n);
  assertEquals(report.collateralReserveLovelace, 20_000_000n);
  assertEquals(report.peakFundingLovelace, 6_030_000_000n);
});

Deno.test("delayed reimbursements reduce drain after payment without hiding upfront funding", () => {
  const report = projectFunding([profile], { receive: 1000 }, {
    ...options,
    reimbursementPerDayLovelace: 2_000_000_000n,
    reimbursementDelayDays: 1,
  });
  assertEquals(report.netFundingConsumedLovelace, 2_000_000_000n);
  assertEquals(report.peakFundingLovelace, 4_030_000_000n);
  assertEquals(report.reimbursementReceivableLovelace, 2_000_000_000n);
});

Deno.test("funding projections reject unknown scenarios, duplicate profiles and invalid rates", () => {
  assertThrows(() => projectFunding([profile], { unknown: 1 }, options));
  assertThrows(() =>
    projectFunding([profile, profile], { receive: 1 }, options)
  );
  for (const rate of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(() => projectFunding([profile], { receive: rate }, options));
  }
  assertThrows(() =>
    projectFunding([profile], { receive: 1 }, { ...options, days: 0 })
  );
  assertThrows(() =>
    projectFunding([profile], { receive: 1 }, { ...options, concurrency: -1 })
  );
});
