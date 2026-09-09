import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  CML,
  Constr,
  Data,
  fromText,
  Lucid,
  type Script,
  type TxBuilder,
  type UTxO,
  utxoToCore,
  validatorToRewardAddress,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  consensusHistoryKey,
  type ConsensusHistoryRecord,
  type ConsensusHistoryWitness,
  encodeConsensusHistoryRecord,
  recordToConstr,
} from "../src/consensus_history_commitment.ts";
import {
  ConsensusHistoryRecovery,
  type HistoryDeployment,
  type HistorySource,
  type HistoryTransaction,
} from "../src/consensus_history_recovery.ts";
import { IncrementalIbcTree } from "../src/incremental_ibc_tree.ts";
import { hashSha3_256, readValidator } from "../src/utils.ts";
import adjacent from "./fixtures/tendermint-adjacent.json" with {
  type: "json",
};
import parameters from "./fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};

// No network calls or real funds. Mainnet epoch 654 limits, prices and V3 model
// are pinned together so reruns do not silently inherit emulator defaults.
const MAX_BYTES = parameters.maxTxSize;
const MAX_MEMORY = BigInt(parameters.maxTxExMem);
const MAX_STEPS = BigInt(parameters.maxTxExSteps);
const COINS_PER_BYTE = BigInt(parameters.coinsPerUtxoByte);
const NOW = adjacent.recommended_emulator_time_ms;
const NOW_NS = BigInt(NOW) * 1_000_000n;
const TOKEN = {
  policyId: "11".repeat(28),
  name: "22".repeat(24) + fromText("0"),
};
const UNIT = TOKEN.policyId + TOKEN.name;
const tokenData = new Constr(0, [TOKEN.policyId, TOKEN.name]);
const heightData = (n: bigint) => new Constr(0, [1n, n]);
const encode = (data: Data) =>
  Data.to<Data>(data, undefined, { canonical: true });
const header =
  (((Data.from(adjacent.spend_client_redeemer_cbor) as Constr<Data>)
    .fields[0] as Constr<Data>).fields[0]) as Constr<Data>;
const tmHeader = (header.fields[0] as Constr<Data>).fields[0] as Constr<Data>;
const clientKey = "clients/07-tendermint-0/clientState";
const publicKey = (n: bigint) => `clients/07-tendermint-0/consensusStates/${n}`;

function record(n: bigint, clientToken = TOKEN) {
  return {
    clientToken,
    height: { revisionNumber: 1n, revisionHeight: n },
    consensusState: {
      timestamp: NOW_NS - 25_000_000_000n + n * 1_000_000n,
      nextValidatorsHash: tmHeader.fields[7] as string,
      root: "33".repeat(32),
    },
    processedTime: NOW_NS - 20_000_000_000n + n * 1_000_000n,
    processedHeight: (NOW_NS - 20_000_000_000n + n * 1_000_000n) /
      4_000_000_000n,
  };
}

function clientDatum(tip: ConsensusHistoryRecord): Constr<Data> {
  const state = new Constr(0, [
    fromText("testchain2-1"),
    new Constr(0, [1n, 3n]),
    120_000_000_000n,
    240_000_000_000n,
    1_000_000_000n,
    new Constr(0, [0n, 0n]),
    heightData(tip.height.revisionHeight),
    [],
  ]);
  const consensus = recordToConstr(tip).fields[2];
  return new Constr(0, [
    new Constr(0, [
      state,
      new Map([[heightData(tip.height.revisionHeight), consensus]]),
      new Map([[heightData(tip.height.revisionHeight), tip.processedTime]]),
      new Map([[heightData(tip.height.revisionHeight), tip.processedHeight]]),
    ]),
    tokenData,
  ]);
}

async function setup(
  count: number,
  updating: boolean,
  publishInitialization = false,
  canonicalEncoding = true,
) {
  const encode = (data: Data) =>
    Data.to<Data>(data, undefined, { canonical: canonicalEncoding });
  const account = generateEmulatorAccount({ lovelace: 1_000_000_000n });
  const emulator = new Emulator([account]);
  emulator.time = NOW - (publishInitialization ? 20_000 : 0);
  Object.assign(emulator.protocolParameters, {
    maxTxSize: MAX_BYTES,
    maxTxExMem: MAX_MEMORY,
    maxTxExSteps: MAX_STEPS,
    coinsPerUtxoByte: COINS_PER_BYTE,
    minFeeA: parameters.minFeeA,
    minFeeB: parameters.minFeeB,
    priceMem: parameters.priceMem,
    priceStep: parameters.priceStep,
    minFeeRefScriptCostPerByte: parameters.minFeeRefScriptCostPerByte,
  });
  emulator.protocolParameters.costModels.PlutusV3 = Object.fromEntries(
    parameters.plutusV3CostModel.map((cost, index) => [String(index), cost]),
  );
  const lucid = await Lucid(emulator, "Preprod");
  lucid.selectWallet.fromSeed(account.seedPhrase);
  const [script, , address] = readValidator(
    "consensus_history_prototype.consensus_history_prototype.spend",
    lucid,
    [tokenData],
  );
  const reward = validatorToRewardAddress("Preprod", script);
  const registration = await lucid.newTx().register.Stake(reward).complete();
  await (await registration.sign.withWallet().complete()).submit();
  emulator.awaitBlock();

  let nextRef = 1;
  function seed(
    address: string,
    datum: string,
    assets = {},
    scriptRef?: Script,
  ): UTxO {
    const utxo: UTxO = {
      txHash: (nextRef++).toString(16).padStart(64, "0"),
      outputIndex: 0,
      address,
      datum,
      assets: { lovelace: 30_000_000n, ...assets },
      scriptRef,
    };
    emulator.ledger[utxo.txHash + utxo.outputIndex] = { utxo, spent: false };
    return utxo;
  }

  const database = new DatabaseSync(":memory:");
  const tree = new IncrementalIbcTree(database);
  const transactions: HistoryTransaction[] = [];
  function retainTransaction(txHash: string, cbor: string) {
    // The emulator has no block-history API. Retain accepted signed bodies
    // with synthetic block identifiers, not predecoded consensus snapshots.
    transactions.push({
      txHash,
      cbor,
      blockHash: createHash("sha256").update(
        `emulator-block-${emulator.blockHeight}`,
      ).digest("hex"),
      blockHeight: emulator.blockHeight,
      slot: emulator.slot,
      transactionIndex: 0,
    });
  }
  const selected = record(1n);
  const started = performance.now();
  for (let n = 1; n <= count; n++) {
    // The fixed signed update is height 2 -> 3. Fill the global root with
    // other clients' records rather than inventing heights below height 2.
    // The lookup benchmark instead uses a single client's sequential history.
    const historical = updating && n > 1
      ? record(1n, { ...TOKEN, name: "22".repeat(24) + fromText(String(n)) })
      : record(BigInt(n));
    tree.set(
      consensusHistoryKey(historical.clientToken, historical.height),
      encodeConsensusHistoryRecord(historical),
    );
    // A full-record commitment supplements the existing public consensus leaf.
    // Keep both so occupancy and rebuild timings reflect the proposed layout.
    const clientId = updating && n > 1 ? n : 0;
    tree.set(
      `clients/07-tendermint-${clientId}/consensusStates/${historical.height.revisionHeight}`,
      encode(recordToConstr(historical).fields[2]),
    );
  }
  const tip = record(updating ? 2n : BigInt(count + 1));
  tip.consensusState.timestamp = BigInt(adjacent.trusted_timestamp_override_ns);
  tip.processedTime = NOW_NS - 5_000_000_000n;
  tip.processedHeight = tip.processedTime / 4_000_000_000n;
  const client = clientDatum(tip);
  const oldClientState = (client.fields[0] as Constr<Data>).fields[0];
  tree.set(clientKey, encode(oldClientState));
  tree.set(
    publicKey(tip.height.revisionHeight),
    encode(recordToConstr(tip).fields[2]),
  );
  const root = await tree.getRoot();
  const buildMilliseconds = Math.round(performance.now() - started);
  const state = new Constr(0, [client, root]);
  let stateUtxo: UTxO;
  if (publishInitialization) {
    // The NFT is a trusted emulator seed. Its initial checkpoint/root must
    // still appear in a real submitted transaction for history-only recovery.
    assertEquals(count, 0, "recovery bootstrap cannot hide historical leaves");
    const funding = seed(account.address, Data.void(), { [UNIT]: 1n });
    const created = await lucid.newTx().collectFrom([funding])
      .pay.ToContract(address, { kind: "inline", value: encode(state) }, {
        [UNIT]: 1n,
      }).complete();
    const signed = await created.sign.withWallet().complete();
    assert(signed.toCBOR().length / 2 <= MAX_BYTES - 750);
    assertEquals(await signed.submit(), signed.toHash());
    emulator.awaitBlock();
    retainTransaction(signed.toHash(), signed.toCBOR());
    stateUtxo = await lucid.utxoByUnit(UNIT);
  } else {
    stateUtxo = seed(address, encode(state), { [UNIT]: 1n });
  }
  const deployment: HistoryDeployment = {
    clientToken: TOKEN,
    stateAddress: address,
    bootstrap: {
      txHash: stateUtxo.txHash,
      outputIndex: stateUtxo.outputIndex,
    },
  };
  const scriptUtxo = seed(account.address, Data.void(), {}, script);

  const minAda = (utxo: UTxO) =>
    CML.min_ada_required(utxoToCore(utxo).output(), COINS_PER_BYTE);
  const archiveName = await hashSha3_256(
    Data.to(new Constr(0, [tokenData, heightData(1n)])),
  );
  const sampleArchive = {
    ...stateUtxo,
    datum: encode(recordToConstr(selected)),
    assets: { lovelace: 2_000_000n, [TOKEN.policyId + archiveName]: 1n },
  };

  async function finish(
    builder: TxBuilder,
    operation: string,
    timings: Record<string, number> = {},
  ) {
    const completed = await builder.complete({ localUPLCEval: true });
    const signed = await completed.sign.withWallet().complete();
    const transaction = signed.toTransaction();
    const units = CML.compute_total_ex_units(
      transaction.witness_set().redeemers()!,
    );
    const bytes = signed.toCBOR().length / 2;
    assert(bytes <= MAX_BYTES - 750, `${bytes} bytes exceeds size headroom`);
    assert(
      units.mem() <= MAX_MEMORY * 95n / 100n,
      `${units.mem()} exceeds memory headroom`,
    );
    assert(
      units.steps() <= MAX_STEPS * 95n / 100n,
      `${units.steps()} exceeds CPU headroom`,
    );
    assertEquals(await signed.submit(), signed.toHash());
    emulator.awaitBlock();
    retainTransaction(signed.toHash(), signed.toCBOR());
    let measuredOutput = utxoToCore(stateUtxo).output();
    const outputs = transaction.body().outputs();
    for (let n = 0; n < outputs.len(); n++) {
      if (outputs.get(n).address().to_bech32() === address) {
        measuredOutput = outputs.get(n);
      }
    }
    const result = {
      operation,
      records: count,
      signedBytes: bytes,
      memory: Number(units.mem()),
      steps: Number(units.steps()),
      feeLovelace: Number(transaction.body().fee()),
      stateOutputBytes: measuredOutput.to_cbor_bytes().length,
      stateMinLovelace: Number(
        CML.min_ada_required(measuredOutput, COINS_PER_BYTE),
      ),
      archiveMinLovelace: Number(minAda(sampleArchive)),
      estimatedSeparateArchiveMinLovelace: Number(minAda(sampleArchive)) *
        count,
      historyOutputCount: 0,
      rootBytes: root.length / 2,
      treeBuildMilliseconds: buildMilliseconds,
      ...timings,
    };
    console.log(JSON.stringify(result));
    return result;
  }

  function lookupBuilder(
    witness: Data,
    proofHeight = 1n,
    useState = stateUtxo,
    mutation = "",
  ) {
    return lucid.newTx().readFrom([useState, scriptUtxo])
      .withdraw(
        reward,
        0n,
        encode(
          new Constr(0, [heightData(proofHeight), new Constr(0, [witness])]),
        ),
      )
      .validFrom(mutation === "early-delay" ? NOW - 20_000 : emulator.now())
      .validTo(
        mutation === "expired" ? NOW + 110_000 : emulator.now() + 10_000,
      );
  }

  async function lookup(mutation = "") {
    const siblings = await tree.getSiblings(
      consensusHistoryKey(TOKEN, selected.height),
    );
    const supplied = structuredClone(selected);
    if (mutation === "time") supplied.processedTime -= 1n;
    if (mutation === "height") supplied.processedHeight -= 1n;
    if (mutation === "revision") supplied.height.revisionNumber = 0n;
    if (mutation === "client") supplied.clientToken.name = "ff";
    if (mutation === "root") supplied.consensusState.root = "ff".repeat(32);
    if (mutation === "proof") siblings[0] = "ff".repeat(32);
    if (mutation === "short") siblings.pop();
    if (mutation === "long") siblings.push("00".repeat(32));
    const witness = new Constr(0, [recordToConstr(supplied), siblings]);
    const useState = mutation === "unauthenticated-root"
      ? seed(address, stateUtxo.datum!)
      : stateUtxo;
    const builder = lookupBuilder(witness, 1n, useState, mutation);
    if (mutation) {
      await assertRejects(() => builder.complete({ localUPLCEval: true }));
      return;
    }
    return await finish(builder, "historical lookup and delay check");
  }

  async function update(mutation = "", historicalTrusted = false) {
    const witnessStarted = performance.now();
    const staleWitness = new Constr(0, [
      recordToConstr(selected),
      await tree.getSiblings(consensusHistoryKey(TOKEN, selected.height)),
    ]);
    const trustedWitnesses: Data[] = historicalTrusted
      ? [
        new Constr(0, [
          recordToConstr(selected),
          await tree.getSiblings(consensusHistoryKey(TOKEN, selected.height)),
        ]),
      ]
      : [];
    const suppliedHeader = Data.from(encode(header)) as Constr<Data>;
    // TrustedHeight is part of the IBC wrapper, not the signed CometBFT header.
    // The unchanged four signatures also verify against this older validator set.
    if (historicalTrusted) suppliedHeader.fields[2] = heightData(1n);
    const nextTip = record(3n);
    nextTip.consensusState = {
      timestamp: tmHeader.fields[3] as bigint,
      nextValidatorsHash: tmHeader.fields[8] as string,
      root: tmHeader.fields[10] as string,
    };
    nextTip.processedTime = NOW_NS + (mutation === "metadata" ? 1n : 0n);
    nextTip.processedHeight = NOW_NS / 4_000_000_000n;
    const nextClient = clientDatum(nextTip);
    const clientSiblings = await tree.getSiblings(clientKey);
    tree.set(
      clientKey,
      encode((nextClient.fields[0] as Constr<Data>).fields[0]),
    );
    const consensusSiblings = await tree.getSiblings(publicKey(3n));
    tree.set(publicKey(3n), encode(recordToConstr(nextTip).fields[2]));
    const archiveKey = consensusHistoryKey(TOKEN, tip.height);
    const archiveSiblings = await tree.getSiblings(archiveKey);
    const archived = structuredClone(tip);
    if (mutation === "archived-metadata") archived.processedTime -= 1n;
    tree.set(archiveKey, encodeConsensusHistoryRecord(archived));
    const nextRoot = await tree.getRoot();
    const updateWitnessMilliseconds = Math.round(
      performance.now() - witnessStarted,
    );
    const nextDatum = encode(
      new Constr(0, [nextClient, mutation === "root" ? root : nextRoot]),
    );
    const redeemer = new Constr(0, [
      suppliedHeader,
      trustedWitnesses,
      clientSiblings,
      consensusSiblings,
      archiveSiblings,
    ]);
    if (mutation === "signature") {
      const mutatedHeader = Data.from(encode(header)) as Constr<Data>;
      const signedHeader = mutatedHeader.fields[0] as Constr<Data>;
      const commit = signedHeader.fields[1] as Constr<Data>;
      for (const signature of commit.fields[3] as Constr<Data>[]) {
        signature.fields[3] = "00".repeat(64);
      }
      redeemer.fields[0] = mutatedHeader;
    }
    const builder = lucid.newTx().readFrom([scriptUtxo])
      .collectFrom([stateUtxo], encode(redeemer))
      .pay.ToContract(address, { kind: "inline", value: nextDatum }, {
        [UNIT]: 1n,
      })
      .validFrom(NOW).validTo(NOW + 30_000);
    if (mutation) {
      await assertRejects(() => builder.complete({ localUPLCEval: true }));
      return;
    }
    const result = await finish(
      builder,
      historicalTrusted
        ? "four-validator update using historical trusted height"
        : "four-validator adjacent update",
      { updateWitnessMilliseconds },
    );
    stateUtxo = await lucid.utxoByUnit(UNIT);
    assertEquals(stateUtxo.datum, nextDatum);
    assertEquals(
      (await lucid.utxosAt(address)).length,
      1,
      "update must not create an archive output",
    );
    assertEquals(stateUtxo.assets[UNIT], 1n);
    await assertRejects(() =>
      lookupBuilder(staleWitness).complete({ localUPLCEval: true })
    );
    // The newly archived tip is now usable without an archive reference input.
    const archivedWitness = new Constr(0, [
      recordToConstr(tip),
      await tree.getSiblings(archiveKey),
    ]);
    await finish(
      lookupBuilder(archivedWitness, 2n),
      "lookup of newly archived tip",
    );
    return result;
  }
  let closed = false;
  return {
    lookup,
    update,
    deployment,
    source(): HistorySource {
      const retained = structuredClone(transactions);
      return {
        async *transactions() {
          for (const transaction of retained) yield transaction;
        },
        currentState: () => lucid.utxoByUnit(UNIT),
      };
    },
    async recoveredLookup(witness: ConsensusHistoryWitness) {
      return await finish(
        lookupBuilder(
          new Constr(0, [recordToConstr(witness.record), witness.siblings]),
          witness.record.height.revisionHeight,
        ),
        "historical lookup after deleting the local database",
      );
    },
    close() {
      if (!closed) database.close();
      closed = true;
    },
  };
}

Deno.test("signed proof-backed history transactions at 1, 100 and 10000 records", async () => {
  const sizes: number[] = [];
  for (const count of [1, 100, 10_000]) {
    const read = await setup(count, false);
    try {
      const result = await read.lookup();
      assert(result);
      sizes.push(result.signedBytes);
    } finally {
      read.close();
    }
    const write = await setup(count, true);
    try {
      await write.update("", true);
    } finally {
      write.close();
    }
  }
  assert(
    Math.max(...sizes) - Math.min(...sizes) < 100,
    "history length must not grow the lookup transaction",
  );
  const adjacent = await setup(1, true);
  try {
    await adjacent.update();
  } finally {
    adjacent.close();
  }
});

Deno.test("history lookups reject modified records, malformed proofs and unauthenticated roots", async () => {
  const fixture = await setup(2, false);
  try {
    for (
      const mutation of [
        "time",
        "height",
        "revision",
        "client",
        "root",
        "proof",
        "short",
        "long",
        "unauthenticated-root",
        "early-delay",
        "expired",
      ]
    ) {
      await fixture.lookup(mutation);
    }
  } finally {
    fixture.close();
  }
});

Deno.test("signed updates reject wrong roots, metadata and invalid Tendermint signatures", async () => {
  for (
    const mutation of ["root", "metadata", "archived-metadata", "signature"]
  ) {
    const fixture = await setup(1, true);
    try {
      await fixture.update(mutation);
    } finally {
      fixture.close();
    }
  }
});

Deno.test("recover from submitted transaction history after deleting every local history cache", async () => {
  const directory = await Deno.makeTempDir({ prefix: "ibc-history-recovery-" });
  const applicationDirectory = `${directory}/application`;
  await Deno.mkdir(applicationDirectory);
  const databasePath = `${applicationDirectory}/history.sqlite`;
  const fixture = await setup(0, true, true);
  let recovery = new ConsensusHistoryRecovery(databasePath, fixture.deployment);
  try {
    // Start with an actual published checkpoint and no hidden history records.
    const initialSource = fixture.source();
    const initialLive = await initialSource.currentState();
    const initial = await recovery.recover(initialSource);
    assertThrows(() =>
      recovery.witness(TOKEN, {
        revisionNumber: 1n,
        revisionHeight: 2n,
      })
    );
    await fixture.update();
    const live = await fixture.source().currentState();
    const expectedRoot = (Data.from(live.datum!) as Constr<Data>)
      .fields[1] as string;
    assert(initial.root !== expectedRoot);
    assertEquals((await recovery.recover(fixture.source())).root, expectedRoot);

    // A saved database is not authority to serve proofs after a restart. It
    // must first agree with the independently queried current state again.
    recovery.close();
    recovery = new ConsensusHistoryRecovery(databasePath, fixture.deployment);
    assertThrows(() =>
      recovery.witness(TOKEN, {
        revisionNumber: 1n,
        revisionHeight: 2n,
      })
    );
    assertEquals((await recovery.recover(fixture.source())).root, expectedRoot);

    // Simulate the archival source rolling back to the initial transaction.
    // The emulator itself is not forked. Replay must discard the removed
    // archival commitment before accepting the canonical update again.
    assertEquals(
      (await recovery.recover({
        transactions: initialSource.transactions,
        currentState: () => Promise.resolve(initialLive),
      })).root,
      initial.root,
    );
    assertThrows(() =>
      recovery.witness(TOKEN, {
        revisionNumber: 1n,
        revisionHeight: 2n,
      })
    );
    assertEquals((await recovery.recover(fixture.source())).root, expectedRoot);

    // Retain only raw transactions as the simulated archival node would. Both
    // the witness-builder tree and the recovery database are then discarded.
    const chain = fixture.source();
    fixture.close();
    recovery.close();
    await Deno.remove(applicationDirectory, { recursive: true });
    await Deno.mkdir(applicationDirectory);
    recovery = new ConsensusHistoryRecovery(databasePath, fixture.deployment);
    const recovered = await recovery.recover(chain);
    assertEquals(recovered.root, expectedRoot);
    const witness = recovery.witness(TOKEN, {
      revisionNumber: 1n,
      revisionHeight: 2n,
    });
    assertEquals(witness.root, expectedRoot);
    assertEquals(witness.record.processedTime, NOW_NS - 5_000_000_000n);
    assertEquals(
      witness.record.processedHeight,
      (NOW_NS - 5_000_000_000n) / 4_000_000_000n,
    );
    const modified = {
      ...witness,
      record: {
        ...witness.record,
        processedTime: witness.record.processedTime - 1n,
      },
    };
    await assertRejects(() => fixture.recoveredLookup(modified));
    await fixture.recoveredLookup(witness);
    console.log(JSON.stringify({
      operation: "cold recovery from accepted transaction CBOR",
      retainedHistoricalRecords: 1,
      ...recovered,
    }));
  } finally {
    recovery.close();
    fixture.close();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("recovery rejects missing or corrupted history and a mismatched live state", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "ibc-history-rejection-",
  });
  const fixture = await setup(0, true, true);
  try {
    await fixture.update();
    const source = fixture.source();
    const live = await source.currentState();
    const transactions: HistoryTransaction[] = [];
    for await (const transaction of source.transactions()) {
      transactions.push(transaction);
    }
    const changedState = structuredClone(live);
    const datum = Data.from(changedState.datum!) as Constr<Data>;
    datum.fields[1] = "ff".repeat(32);
    changedState.datum = encode(datum);
    const cases = [
      { name: "missing bootstrap", transactions: transactions.slice(1), live },
      {
        name: "missing predecessor update",
        transactions: transactions.filter((tx) => tx.txHash !== live.txHash),
        live,
      },
      {
        name: "corrupt transaction hash",
        transactions: transactions.map((tx, n) =>
          n === 1 ? { ...tx, txHash: "ff".repeat(32) } : tx
        ),
        live,
      },
      {
        name: "corrupt transaction body",
        transactions: transactions.map((tx, n) =>
          n === 1 ? { ...tx, cbor: "00" } : tx
        ),
        live,
      },
      { name: "wrong live root", transactions, live: changedState },
      {
        name: "wrong live output reference",
        transactions,
        live: { ...live, outputIndex: live.outputIndex + 1 },
      },
    ];
    for (const [n, candidate] of cases.entries()) {
      const recovery = new ConsensusHistoryRecovery(
        `${directory}/${n}.sqlite`,
        fixture.deployment,
      );
      try {
        await assertRejects(
          () =>
            recovery.recover({
              async *transactions() {
                for (const transaction of candidate.transactions) {
                  yield transaction;
                }
              },
              currentState: () => Promise.resolve(candidate.live),
            }),
          Error,
          "",
          candidate.name,
        );
      } finally {
        recovery.close();
      }
    }
  } finally {
    fixture.close();
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("recover public commitments from signed transactions with indefinite CBOR constructors", async () => {
  const directory = await Deno.makeTempDir({ prefix: "ibc-history-encoding-" });
  const fixture = await setup(0, true, true, false);
  const recovery = new ConsensusHistoryRecovery(
    `${directory}/history.sqlite`,
    fixture.deployment,
  );
  try {
    await fixture.update();
    fixture.close();
    const source = fixture.source();
    const live = await source.currentState();
    const expectedRoot = (Data.from(live.datum!) as Constr<Data>)
      .fields[1] as string;
    assertEquals((await recovery.recover(source)).root, expectedRoot);
    const witness = recovery.witness(TOKEN, {
      revisionNumber: 1n,
      revisionHeight: 2n,
    });
    assertEquals(witness.record.processedTime, NOW_NS - 5_000_000_000n);
    await fixture.recoveredLookup(witness);
  } finally {
    recovery.close();
    fixture.close();
    await Deno.remove(directory, { recursive: true });
  }
});
