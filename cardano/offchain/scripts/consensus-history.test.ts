import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CML,
  Constr,
  Data,
  fromText,
  getAddressDetails,
  Lucid,
  type Script,
  type UTxO,
  validatorToRewardAddress,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import { DeploymentIbcTree } from "../src/deployment.ts";
import {
  generateTokenName,
  hashSha3_256,
  readValidator,
} from "../src/utils.ts";
import { HostStateDatum, HostStateRedeemer } from "../types/index.ts";
import adjacentFixture from "./fixtures/tendermint-adjacent.json" with {
  type: "json",
};

const HOST_POLICY = "11".repeat(28);
const HOST_NAME = fromText("ibc_host_state");
const TRUSTING_PERIOD = 60_000_000_000n;
const adjacentRedeemer = Data.from(
  adjacentFixture.spend_client_redeemer_cbor,
) as Constr<Data>;
const adjacentHeader =
  ((adjacentRedeemer.fields[0] as Constr<Data>).fields[0]) as Constr<Data>;
const adjacentTmHeader =
  ((adjacentHeader.fields[0] as Constr<Data>).fields[0]) as Constr<Data>;
const proofSpecs = [[33n, 4n, 12n], [32n, 1n, 1n]].map(([size, min, max]) =>
  new Constr(0, [
    new Constr(0, [1n, 0n, 1n, 1n, "00"]),
    new Constr(0, [[0n, 1n], size, min, max, "", 1n]),
    0n,
    0n,
    new Constr(0, []),
  ])
);
// Hash a freshly constructed key with Plutus constructor-array encoding.
const encode = (value: Data) => Data.to<Data>(value);
const encodeStored = (value: Data) =>
  Data.to<Data>(value, undefined, { canonical: true });
const consensus = (time: bigint) =>
  new Constr(0, [time, "22".repeat(32), new Constr(0, ["33".repeat(32)])]);
const consensusKey = (n: bigint) =>
  `clients/07-tendermint-0/consensusStates/${n}`;

async function fixture(
  historyCount: number,
  recovery = false,
  unexpired = false,
  normalUpdate = false,
) {
  const account = generateEmulatorAccount({ lovelace: 1_000_000_000n });
  const emulator = new Emulator([account]);
  if (normalUpdate) {
    emulator.time = adjacentFixture.recommended_emulator_time_ms;
  }
  const height = (n: bigint) => new Constr(0, [normalUpdate ? 1n : 0n, n]);
  emulator.protocolParameters.maxTxSize = 16_384;
  emulator.protocolParameters.maxTxExMem = 16_500_000n;
  emulator.protocolParameters.maxTxExSteps = 10_000_000_000n;
  const lucid = await Lucid(emulator, "Preprod");
  lucid.selectWallet.fromSeed(account.seedPhrase);
  const dummy = "44".repeat(28);
  const applyBytes = (title: string, params: string[]) =>
    readValidator(
      title,
      lucid,
      params,
      Data.Tuple(params.map(() => Data.Bytes())) as unknown as string[],
    );
  const [archiveScript, archiveHash, archiveAddress] = applyBytes(
    "spending_consensus_state.spend_consensus_state.spend",
    [HOST_POLICY],
  );
  const [recoveryScript, recoveryHash] = applyBytes(
    "recover_client.recover_client.withdraw",
    [HOST_POLICY],
  );
  const [clientScript, clientHash, clientAddress] = readValidator(
    "spending_client.spend_client.spend",
    lucid,
    [HOST_POLICY, new Constr(1, [recoveryHash])],
  );
  const [clientPolicy, clientPolicyId] = applyBytes(
    "minting_client_stt.mint_client_stt.mint",
    [clientHash, HOST_POLICY, archiveHash],
  );
  const [hostScript, , hostAddress] = applyBytes(
    "host_state_stt.host_state_stt.spend",
    [HOST_POLICY, clientHash, dummy, dummy, clientPolicyId],
  );
  const rewardAddress = validatorToRewardAddress("Preprod", recoveryScript);
  if (recovery) {
    const registration = await lucid.newTx().register.Stake(rewardAddress)
      .complete();
    await (await registration.sign.withWallet().complete()).submit();
    emulator.awaitBlock();
  }
  const clientName = await generateTokenName(
    { policy_id: HOST_POLICY, name: HOST_NAME },
    fromText("ibc_client"),
    0n,
  );
  const clientToken = new Constr(0, [clientPolicyId, clientName]);
  const latestHeight = BigInt(historyCount + 1);
  const now = emulator.now();
  const nowNs = BigInt(now) * 1_000_000n;
  const oldConsensus = consensus(
    nowNs - (unexpired ? TRUSTING_PERIOD / 2n : 2n * TRUSTING_PERIOD),
  );
  const latestConsensus = normalUpdate
    ? new Constr(0, [
      BigInt(adjacentFixture.trusted_timestamp_override_ns),
      adjacentTmHeader.fields[7],
      new Constr(0, ["33".repeat(32)]),
    ])
    : recovery
    ? oldConsensus
    : consensus(nowNs - 1_000_000_000n);
  const clientState = new Constr(0, [
    fromText(normalUpdate ? "testchain2-1" : "chain-0"),
    new Constr(0, [1n, 3n]),
    TRUSTING_PERIOD,
    2n * TRUSTING_PERIOD,
    1_000_000_000n,
    new Constr(0, [0n, 0n]),
    height(latestHeight),
    proofSpecs,
  ]);
  const clientDatum = new Constr(0, [
    new Constr(0, [
      clientState,
      new Map([[height(latestHeight), latestConsensus]]),
      new Map([[height(latestHeight), nowNs]]),
      new Map([[height(latestHeight), 1n]]),
    ]),
    clientToken,
  ]);
  let nextRef = 1;
  function seed(
    address: string,
    assets: Record<string, bigint>,
    datum?: string,
    scriptRef?: Script,
  ): UTxO {
    const utxo: UTxO = {
      txHash: (nextRef++).toString(16).padStart(64, "0"),
      outputIndex: 0,
      address,
      assets: { lovelace: 30_000_000n, ...assets },
      datum,
      scriptRef,
    };
    emulator.ledger[utxo.txHash + utxo.outputIndex] = { utxo, spent: false };
    return utxo;
  }
  const client = seed(
    clientAddress,
    { [clientPolicyId + clientName]: 1n },
    encodeStored(clientDatum),
  );
  const references = [hostScript, clientPolicy, archiveScript].map((script) =>
    seed(account.address, {}, Data.void(), script)
  );
  const tree = new DeploymentIbcTree();
  tree.set("clients/07-tendermint-0/clientState", encodeStored(clientState));
  tree.set(consensusKey(latestHeight), encodeStored(latestConsensus));
  const archives: Array<{ utxo: UTxO; unit: string; height: bigint }> = [];
  for (let n = 1n; n <= BigInt(historyCount); n++) {
    const historicalConsensus = normalUpdate && n === 2n
      ? latestConsensus
      : oldConsensus;
    const record = new Constr(0, [
      clientToken,
      height(n),
      historicalConsensus,
      historicalConsensus.fields[0],
      n,
    ]);
    const name = await hashSha3_256(
      encode(new Constr(0, [clientToken, height(n)])),
    );
    const unit = clientPolicyId + name;
    archives.push({
      utxo: seed(archiveAddress, { [unit]: 1n }, encodeStored(record)),
      unit,
      height: n,
    });
    tree.set(consensusKey(n), encodeStored(historicalConsensus));
  }
  const signer = getAddressDetails(account.address).paymentCredential!.hash;
  let hostDatum: HostStateDatum = {
    state: {
      version: 0n,
      ibc_state_root: await tree.getRoot(),
      next_client_sequence: 1n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: [],
      last_update_time: BigInt(now),
    },
    nft_policy: HOST_POLICY,
    deployer: signer,
    control: { port_registry: new Map(), shutdown: "Active" },
  };
  let host = seed(
    hostAddress,
    { [HOST_POLICY + HOST_NAME]: 1n },
    Data.to(hostDatum, HostStateDatum, { canonical: true }),
  );

  async function prune(
    index: number,
    mutation?: "wrong-root" | "unexpired" | "two-records",
  ) {
    const record = archives[index];
    const siblings = await tree.getSiblings(consensusKey(record.height));
    tree.set(consensusKey(record.height), "");
    const root = await tree.getRoot();
    // Do not publish the local tree change until the transaction is accepted.
    tree.set(consensusKey(record.height), encodeStored(oldConsensus));
    const nextDatum: HostStateDatum = {
      ...hostDatum,
      state: {
        ...hostDatum.state,
        version: hostDatum.state.version + 1n,
        ibc_state_root: mutation === "wrong-root"
          ? hostDatum.state.ibc_state_root
          : root,
      },
    };
    const redeemer = Data.to(
      {
        PruneConsensusState: {
          client_token: { policyId: clientPolicyId, name: clientName },
          height: { revisionNumber: 0n, revisionHeight: record.height },
          consensus_state_siblings: siblings,
        },
      },
      HostStateRedeemer,
      { canonical: true },
    );
    const batch = mutation === "two-records"
      ? [record, archives[index + 1]]
      : [record];
    const builder = lucid.newTx().readFrom([client, ...references])
      .collectFrom([host], redeemer)
      .collectFrom(batch.map((entry) => entry.utxo), Data.void())
      .mintAssets(
        Object.fromEntries(batch.map((entry) => [entry.unit, -1n])),
        encodeStored(new Constr(2, [clientToken, height(record.height)])),
      )
      .pay.ToContract(hostAddress, {
        kind: "inline",
        value: Data.to(nextDatum, HostStateDatum, { canonical: true }),
      }, host.assets)
      .validFrom(now)
      .validTo(now + 30_000);
    const completed = await builder.complete({ localUPLCEval: true });
    const signed = await completed.sign.withWallet().complete();
    const transaction = signed.toTransaction();
    const units = CML.compute_total_ex_units(
      transaction.witness_set().redeemers()!,
    );
    const bytes = signed.toCBOR().length / 2;
    assert(bytes <= 16_384 - 750, `prune uses ${bytes} signed bytes`);
    assert(
      units.mem() <= 15_675_000n,
      `prune uses ${units.mem()} memory units`,
    );
    assert(
      units.steps() <= 9_500_000_000n,
      `prune uses ${units.steps()} CPU steps`,
    );
    assertEquals(transaction.body().reference_inputs()?.len(), 4);
    assertEquals(await signed.submit(), signed.toHash());
    emulator.awaitBlock();
    tree.set(consensusKey(record.height), "");
    hostDatum = nextDatum;
    host = await lucid.utxoByUnit(HOST_POLICY + HOST_NAME);
    assertEquals(await lucid.utxosAtWithUnit(archiveAddress, record.unit), []);
    assertEquals(
      (await lucid.utxoByUnit(clientPolicyId + clientName)).datum,
      client.datum,
    );
    return {
      historyCount,
      bytes,
      memory: Number(units.mem()),
      steps: Number(units.steps()),
    };
  }

  async function recover(
    mutation?: "missing-archive" | "changed-metadata" | "wrong-root",
  ) {
    const substituteHeight = latestHeight + 1n;
    const substituteName = await generateTokenName(
      { policy_id: HOST_POLICY, name: HOST_NAME },
      fromText("ibc_client"),
      1n,
    );
    const substituteToken = new Constr(0, [clientPolicyId, substituteName]);
    const substituteState = new Constr(0, [
      ...clientState.fields.slice(0, 6),
      height(substituteHeight),
      proofSpecs,
    ]);
    const substituteConsensus = consensus(nowNs - 1_000_000_000n);
    const nextClientState = new Constr(0, [
      substituteState,
      new Map([[height(substituteHeight), substituteConsensus]]),
      new Map([[height(substituteHeight), nowNs]]),
      new Map([[height(substituteHeight), 1n]]),
    ]);
    const substitute = seed(clientAddress, {
      [clientPolicyId + substituteName]: 1n,
    }, encodeStored(new Constr(0, [nextClientState, substituteToken])));
    tree.set(
      "clients/07-tendermint-1/clientState",
      encodeStored(substituteState),
    );
    tree.set(
      `clients/07-tendermint-1/consensusStates/${substituteHeight}`,
      encodeStored(substituteConsensus),
    );
    hostDatum = {
      ...hostDatum,
      state: {
        ...hostDatum.state,
        next_client_sequence: 2n,
        ibc_state_root: await tree.getRoot(),
      },
    };
    host.datum = Data.to(hostDatum, HostStateDatum, { canonical: true });
    const clientSiblings = await tree.getSiblings(
      "clients/07-tendermint-0/clientState",
    );
    tree.set(
      "clients/07-tendermint-0/clientState",
      encodeStored(substituteState),
    );
    const consensusSiblings = await tree.getSiblings(
      consensusKey(substituteHeight),
    );
    tree.set(consensusKey(substituteHeight), encodeStored(substituteConsensus));
    const nextHost = {
      ...hostDatum,
      state: {
        ...hostDatum.state,
        version: hostDatum.state.version + 1n,
        ibc_state_root: mutation === "wrong-root"
          ? hostDatum.state.ibc_state_root
          : await tree.getRoot(),
      },
    };
    const archived = new Constr(0, [
      clientToken,
      height(latestHeight),
      latestConsensus,
      mutation === "changed-metadata" ? nowNs + 1n : nowNs,
      1n,
    ]);
    const archiveUnit = clientPolicyId +
      await hashSha3_256(
        encode(new Constr(0, [clientToken, height(latestHeight)])),
      );
    const recoveryReferences = [clientScript, recoveryScript].map((script) =>
      seed(account.address, {}, Data.void(), script)
    );
    let builder = lucid.newTx().readFrom([
      substitute,
      ...references.slice(0, 2),
      ...recoveryReferences,
    ])
      .collectFrom(
        [host],
        Data.to(
          {
            UpdateClient: {
              client_state_siblings: clientSiblings,
              consensus_state_siblings: consensusSiblings,
              removed_consensus_state_siblings: [],
            },
          },
          HostStateRedeemer,
          { canonical: true },
        ),
      )
      .collectFrom([client], encodeStored(new Constr(1, [substituteToken])))
      .mintAssets(
        { [archiveUnit]: 1n },
        encodeStored(new Constr(1, [clientToken])),
      )
      .withdraw(
        rewardAddress,
        0n,
        encodeStored(new Constr(0, [clientToken, substituteToken])),
      )
      .pay.ToContract(clientAddress, {
        kind: "inline",
        value: encodeStored(new Constr(0, [nextClientState, clientToken])),
      }, client.assets)
      .pay.ToContract(hostAddress, {
        kind: "inline",
        value: Data.to(nextHost, HostStateDatum, { canonical: true }),
      }, host.assets)
      .validFrom(now).validTo(now + 30_000).addSignerKey(signer);
    if (mutation !== "missing-archive") {
      builder = builder.pay.ToContract(archiveAddress, {
        kind: "inline",
        value: encodeStored(archived),
      }, { [archiveUnit]: 1n });
    }
    const completed = await builder.complete({ localUPLCEval: true });
    const signed = await completed.sign.withWallet().complete();
    const units = CML.compute_total_ex_units(
      signed.toTransaction().witness_set().redeemers()!,
    );
    const bytes = signed.toCBOR().length / 2;
    assert(bytes <= 16_384 - 750, `recovery uses ${bytes} signed bytes`);
    assert(
      units.mem() <= 15_675_000n,
      `recovery uses ${units.mem()} memory units`,
    );
    assert(
      units.steps() <= 9_500_000_000n,
      `recovery uses ${units.steps()} CPU steps`,
    );
    assertEquals(await signed.submit(), signed.toHash());
    emulator.awaitBlock();
    assertEquals(
      (await lucid.utxoByUnit(archiveUnit)).datum,
      encodeStored(archived),
    );
    assertEquals(
      (await lucid.utxoByUnit(clientPolicyId + clientName)).datum,
      encodeStored(new Constr(0, [nextClientState, clientToken])),
    );
    return {
      operation: "recovery",
      historyCount,
      bytes,
      memory: Number(units.mem()),
      steps: Number(units.steps()),
    };
  }
  async function update(wrongProcessingTime = false) {
    const newHeight = adjacentTmHeader.fields[2] as bigint;
    const newConsensus = new Constr(0, [
      adjacentTmHeader.fields[3],
      adjacentTmHeader.fields[8],
      new Constr(0, [adjacentTmHeader.fields[10]]),
    ]);
    const newState = new Constr(0, [
      ...clientState.fields.slice(0, 6),
      height(newHeight),
      proofSpecs,
    ]);
    const nextClient = new Constr(0, [
      new Constr(0, [
        newState,
        new Map([[height(newHeight), newConsensus]]),
        new Map([[height(newHeight), nowNs + (wrongProcessingTime ? 1n : 0n)]]),
        new Map([[height(newHeight), nowNs / 4_000_000_000n]]),
      ]),
      clientToken,
    ]);
    const clientSiblings = await tree.getSiblings(
      "clients/07-tendermint-0/clientState",
    );
    tree.set("clients/07-tendermint-0/clientState", encodeStored(newState));
    const consensusSiblings = await tree.getSiblings(consensusKey(newHeight));
    tree.set(consensusKey(newHeight), encodeStored(newConsensus));
    const nextHost = {
      ...hostDatum,
      state: {
        ...hostDatum.state,
        version: hostDatum.state.version + 1n,
        ibc_state_root: await tree.getRoot(),
      },
    };
    const archived = new Constr(0, [
      clientToken,
      height(latestHeight),
      latestConsensus,
      nowNs,
      1n,
    ]);
    const archiveUnit = clientPolicyId +
      await hashSha3_256(
        encode(new Constr(0, [clientToken, height(latestHeight)])),
      );
    const clientReference = seed(
      account.address,
      {},
      Data.void(),
      clientScript,
    );
    const completed = await lucid.newTx().readFrom([
      ...references.slice(0, 2),
      clientReference,
    ])
      .collectFrom(
        [host],
        Data.to(
          {
            UpdateClient: {
              client_state_siblings: clientSiblings,
              consensus_state_siblings: consensusSiblings,
              removed_consensus_state_siblings: [],
            },
          },
          HostStateRedeemer,
          { canonical: true },
        ),
      )
      .collectFrom([client], encodeStored(adjacentRedeemer))
      .mintAssets(
        { [archiveUnit]: 1n },
        encodeStored(new Constr(1, [clientToken])),
      )
      .pay.ToContract(clientAddress, {
        kind: "inline",
        value: encodeStored(nextClient),
      }, client.assets)
      .pay.ToContract(hostAddress, {
        kind: "inline",
        value: Data.to(nextHost, HostStateDatum, { canonical: true }),
      }, host.assets)
      .pay.ToContract(archiveAddress, {
        kind: "inline",
        value: encodeStored(archived),
      }, { [archiveUnit]: 1n })
      .validFrom(now).validTo(now + 30_000).complete({ localUPLCEval: true });
    const signed = await completed.sign.withWallet().complete();
    const units = CML.compute_total_ex_units(
      signed.toTransaction().witness_set().redeemers()!,
    );
    const bytes = signed.toCBOR().length / 2;
    assert(bytes <= 16_384 - 750, `update uses ${bytes} signed bytes`);
    assert(
      units.mem() <= 15_675_000n,
      `update uses ${units.mem()} memory units`,
    );
    assert(
      units.steps() <= 9_500_000_000n,
      `update uses ${units.steps()} CPU steps`,
    );
    assertEquals(await signed.submit(), signed.toHash());
    emulator.awaitBlock();
    assertEquals(
      (await lucid.utxoByUnit(archiveUnit)).datum,
      encodeStored(archived),
    );
    assertEquals(
      (await lucid.utxoByUnit(clientPolicyId + clientName)).datum,
      encodeStored(nextClient),
    );
    // Replaying the same valid header must not be accepted as misbehaviour.
    const frozenState = new Constr(0, [
      ...newState.fields.slice(0, 5),
      new Constr(0, [0n, 1n]),
      ...newState.fields.slice(6),
    ]);
    const frozenClient = new Constr(0, [
      new Constr(0, [
        frozenState,
        ...(nextClient.fields[0] as Constr<Data>).fields.slice(1),
      ]),
      clientToken,
    ]);
    const freezeSiblings = await tree.getSiblings(
      "clients/07-tendermint-0/clientState",
    );
    tree.set("clients/07-tendermint-0/clientState", encodeStored(frozenState));
    const frozenHost = {
      ...nextHost,
      state: {
        ...nextHost.state,
        version: nextHost.state.version + 1n,
        ibc_state_root: await tree.getRoot(),
      },
    };
    const replay = lucid.newTx().readFrom([
      references[0],
      clientReference,
      await lucid.utxoByUnit(archiveUnit),
    ])
      .collectFrom(
        [await lucid.utxoByUnit(HOST_POLICY + HOST_NAME)],
        Data.to(
          {
            UpdateClient: {
              client_state_siblings: freezeSiblings,
              consensus_state_siblings: [],
              removed_consensus_state_siblings: [],
            },
          },
          HostStateRedeemer,
          { canonical: true },
        ),
      )
      .collectFrom(
        [await lucid.utxoByUnit(clientPolicyId + clientName)],
        encodeStored(adjacentRedeemer),
      )
      .pay.ToContract(clientAddress, {
        kind: "inline",
        value: encodeStored(frozenClient),
      }, client.assets)
      .pay.ToContract(hostAddress, {
        kind: "inline",
        value: Data.to(frozenHost, HostStateDatum, { canonical: true }),
      }, host.assets)
      .validFrom(now).validTo(now + 30_000);
    await assertRejects(() => replay.complete({ localUPLCEval: true }));
    return {
      operation: "four-validator update",
      bytes,
      memory: Number(units.mem()),
      steps: Number(units.steps()),
    };
  }
  async function freezeConflictingHeader() {
    const frozenState = new Constr(0, [
      ...clientState.fields.slice(0, 5),
      new Constr(0, [0n, 1n]),
      ...clientState.fields.slice(6),
    ]);
    const frozenClient = new Constr(0, [
      new Constr(0, [
        frozenState,
        ...(clientDatum.fields[0] as Constr<Data>).fields.slice(1),
      ]),
      clientToken,
    ]);
    const siblings = await tree.getSiblings(
      "clients/07-tendermint-0/clientState",
    );
    tree.set("clients/07-tendermint-0/clientState", encodeStored(frozenState));
    const frozenHost = {
      ...hostDatum,
      state: {
        ...hostDatum.state,
        version: hostDatum.state.version + 1n,
        ibc_state_root: await tree.getRoot(),
      },
    };
    const clientReference = seed(
      account.address,
      {},
      Data.void(),
      clientScript,
    );
    const completed = await lucid.newTx().readFrom([
      references[0],
      clientReference,
      archives[1].utxo,
    ])
      .collectFrom(
        [host],
        Data.to(
          {
            UpdateClient: {
              client_state_siblings: siblings,
              consensus_state_siblings: [],
              removed_consensus_state_siblings: [],
            },
          },
          HostStateRedeemer,
          { canonical: true },
        ),
      )
      .collectFrom([client], encodeStored(adjacentRedeemer))
      .pay.ToContract(clientAddress, {
        kind: "inline",
        value: encodeStored(frozenClient),
      }, client.assets)
      .pay.ToContract(hostAddress, {
        kind: "inline",
        value: Data.to(frozenHost, HostStateDatum, { canonical: true }),
      }, host.assets)
      .validFrom(now).validTo(now + 30_000).complete({ localUPLCEval: true });
    const signed = await completed.sign.withWallet().complete();
    const units = CML.compute_total_ex_units(
      signed.toTransaction().witness_set().redeemers()!,
    );
    assert(signed.toCBOR().length / 2 <= 16_384 - 750);
    assert(units.mem() <= 15_675_000n);
    assert(units.steps() <= 9_500_000_000n);
    assertEquals(await signed.submit(), signed.toHash());
    emulator.awaitBlock();
    assertEquals(
      (await lucid.utxoByUnit(clientPolicyId + clientName)).datum,
      encodeStored(frozenClient),
    );
  }
  return {
    prune,
    recover,
    update,
    freezeConflictingHeader,
    lucid,
    archives,
    client,
    tree,
  };
}

Deno.test("signed pruning transactions remain bounded with 1 and 300 archived states", async () => {
  for (const count of [1, 300]) {
    const context = await fixture(count);
    console.log(JSON.stringify(await context.prune(0)));
    if (count === 300) {
      // Cleanup resumes in another transaction without rewriting the active client.
      console.log(JSON.stringify(await context.prune(1)));
      assertEquals(
        (await context.lucid.utxoByUnit(context.archives[299].unit)).datum,
        context.archives[299].utxo.datum,
      );
    }
  }
});

Deno.test("the complete pruning transaction rejects wrong roots, unexpired states and two-record batches", async () => {
  for (const mutation of ["wrong-root", "unexpired", "two-records"] as const) {
    const context = await fixture(2, false, mutation === "unexpired");
    await assertRejects(() => context.prune(0, mutation));
  }
});

Deno.test("signed recovery archives the expired tip without loading 1 or 300 older states", async () => {
  for (const count of [1, 300]) {
    console.log(JSON.stringify(await (await fixture(count, true)).recover()));
  }
});

Deno.test("signed recovery rejects missing archives, changed metadata and wrong roots", async () => {
  for (
    const mutation of [
      "missing-archive",
      "changed-metadata",
      "wrong-root",
    ] as const
  ) {
    await assertRejects(() =>
      fixture(1, true).then((context) => context.recover(mutation))
    );
  }
});

Deno.test("a signed four-validator header update archives its previous tip", async () => {
  console.log(
    JSON.stringify(await (await fixture(1, false, false, true)).update()),
  );
});

Deno.test("a signed header update cannot forge its new processing metadata", async () => {
  const context = await fixture(1, false, false, true);
  await assertRejects(() => context.update(true));
});

Deno.test("a signed conflicting header freezes a client using its archived trusted height", async () => {
  // The trusted live height3 checkpoint differs from the valid signed height3
  // header. Its height2 trust anchor is an immutable historical reference.
  await (await fixture(2, false, false, true)).freezeConflictingHeader();
});
