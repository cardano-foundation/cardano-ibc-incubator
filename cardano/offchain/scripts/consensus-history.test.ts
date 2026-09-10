import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CML,
  Constr,
  Data,
  fromText,
  getAddressDetails,
  Lucid,
  type Script,
  type TxSignBuilder,
  type UTxO,
  validatorToRewardAddress,
} from "@lucid-evolution/lucid";
import {
  Emulator,
  generateEmulatorAccount,
  generateEmulatorAccountFromPrivateKey,
} from "@lucid-evolution/provider";
import { DeploymentIbcTree } from "../src/deployment.ts";
import { generateTokenName, readValidator } from "../src/utils.ts";
import { HostStateDatum, HostStateRedeemer } from "../types/index.ts";
import {
  ConsensusHistoryRecovery,
  type HistorySource,
  type HistoryTransaction,
} from "../src/consensus_history_recovery.ts";
import { historyPacketFixture } from "./consensus-history-packet-fixture.ts";
import { serialisePlutusData } from "../src/plutus_serialise.ts";
import {
  consensusHistoryKey,
  encodeConsensusHistoryRecord,
  recordFromConstr,
} from "../src/consensus_history_commitment.ts";
import adjacentFixture from "./fixtures/tendermint-adjacent.json" with {
  type: "json",
};

const HOST_POLICY = "11".repeat(28);
const HOST_NAME = fromText("ibc_host_state");
const TRUSTING_PERIOD = 120_000_000_000n;
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
const consensus = (time: bigint) =>
  new Constr(0, [time, "22".repeat(32), new Constr(0, ["33".repeat(32)])]);
const consensusKey = (n: bigint) =>
  `clients/07-tendermint-0/consensusStates/${n}`;

async function fixture(
  historyCount: number,
  recovery = false,
  unexpired = false,
  normalUpdate = false,
  createClient = false,
  canonicalEncoding = true,
  packetRecovery = false,
  outputCanonicalEncoding = canonicalEncoding,
  captureSignerFixture?: (value: Record<string, unknown>) => void,
) {
  const encodeStored = (value: Data) =>
    Data.to<Data>(value, undefined, { canonical: canonicalEncoding });
  const encodePublic = (value: Data) =>
    serialisePlutusData(encodeStored(value));
  const encodeOutput = (value: Data) =>
    Data.to<Data>(value, undefined, { canonical: outputCanonicalEncoding });
  const account = captureSignerFixture
    ? generateEmulatorAccountFromPrivateKey({ lovelace: 1_000_000_000n })
    : generateEmulatorAccount({ lovelace: 1_000_000_000n });
  const emulator = new Emulator([account]);
  if (normalUpdate) {
    emulator.time = adjacentFixture.recommended_emulator_time_ms;
  }
  const height = (n: bigint) => new Constr(0, [normalUpdate ? 1n : 0n, n]);
  emulator.protocolParameters.maxTxSize = 16_384;
  emulator.protocolParameters.maxTxExMem = 16_500_000n;
  emulator.protocolParameters.maxTxExSteps = 10_000_000_000n;
  const lucid = await Lucid(emulator, "Preprod");
  if (captureSignerFixture) {
    lucid.selectWallet.fromPrivateKey(account.privateKey);
  } else lucid.selectWallet.fromSeed(account.seedPhrase);
  const dummy = "44".repeat(28);
  const applyBytes = (title: string, params: string[]) =>
    readValidator(
      title,
      lucid,
      params,
      Data.Tuple(params.map(() => Data.Bytes())) as unknown as string[],
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
    [clientHash, HOST_POLICY],
  );
  const packet = packetRecovery
    ? await historyPacketFixture(lucid, HOST_POLICY, HOST_NAME, clientPolicyId)
    : undefined;
  const [hostScript, hostHash, hostAddress] = applyBytes(
    "host_state_stt.host_state_stt.spend",
    [
      HOST_POLICY,
      clientHash,
      dummy,
      packet?.channelHash ?? dummy,
      clientPolicyId,
    ],
  );
  const rewardAddress = validatorToRewardAddress("Preprod", recoveryScript);
  if (recovery || normalUpdate) {
    const registration = await lucid.newTx().register.Stake(rewardAddress)
      .complete();
    await (await registration.sign.withWallet().complete()).submit();
    emulator.awaitBlock();
  }
  let signerFunding: UTxO | undefined;
  if (captureSignerFixture) {
    // Hermes requires disjoint spending/collateral inputs. Fund fees from a
    // small real output, leaving the larger wallet output for Lucid collateral.
    const split = await lucid.newTx().pay.ToAddress(account.address, {
      lovelace: 10_000_000n,
    }).complete();
    const signed = await split.sign.withWallet().complete();
    assertEquals(await signed.submit(), signed.toHash());
    emulator.awaitBlock();
    signerFunding = (await lucid.utxosAt(account.address)).find((utxo) =>
      utxo.txHash === signed.toHash() && utxo.assets.lovelace === 10_000_000n
    );
    assert(signerFunding);
  }
  const newFundedTx = () => {
    const tx = lucid.newTx();
    return signerFunding ? tx.collectFrom([signerFunding]) : tx;
  };
  const clientName = await generateTokenName(
    { policy_id: HOST_POLICY, name: HOST_NAME },
    fromText("ibc_client"),
    0n,
  );
  const clientToken = new Constr(0, [clientPolicyId, clientName]);
  const latestHeight = normalUpdate && historyCount === 0
    ? 2n
    : BigInt(historyCount + 1);
  const now = emulator.now();
  const nowNs = BigInt(now) * 1_000_000n;
  const initialProcessedHeight = createClient ? nowNs / 4_000_000_000n : 1n;
  const oldConsensus = consensus(
    nowNs - (unexpired ? TRUSTING_PERIOD / 2n : 2n * TRUSTING_PERIOD),
  );
  const latestConsensus = normalUpdate
    ? new Constr(0, [
      BigInt(adjacentFixture.trusted_timestamp_override_ns),
      adjacentTmHeader.fields[7],
      new Constr(0, [packet?.root ?? "33".repeat(32)]),
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
  const clientDatum = new Constr<Data>(0, [
    new Constr(0, [
      clientState,
      new Map([[height(latestHeight), latestConsensus]]),
      new Map([[height(latestHeight), nowNs]]),
      new Map([[height(latestHeight), initialProcessedHeight]]),
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
      assets: {
        lovelace: captureSignerFixture ? 5_000_000n : 30_000_000n,
        ...assets,
      },
      datum,
      scriptRef,
    };
    emulator.ledger[utxo.txHash + utxo.outputIndex] = { utxo, spent: false };
    return utxo;
  }
  let client = seed(
    clientAddress,
    { [clientPolicyId + clientName]: 1n },
    encodeStored(clientDatum),
  );
  const references = [hostScript, clientPolicy, recoveryScript].map((script) =>
    seed(account.address, {}, Data.void(), script)
  );
  function signerEvidence(
    name: "update" | "recovery",
    completed: TxSignBuilder,
    clientReference: UTxO,
  ) {
    if (!captureSignerFixture) return undefined;
    const outRef = (utxo: UTxO) => ({
      tx_hash: utxo.txHash,
      output_index: utxo.outputIndex,
    });
    const resolve = (inputs: CML.TransactionInputList | undefined) => {
      const result = [];
      for (let index = 0; index < (inputs?.len() ?? 0); index++) {
        const input = inputs!.get(index);
        const txHash = input.transaction_id().to_hex();
        const outputIndex = Number(input.index());
        // Trusted test-chain state, never values supplied by the candidate.
        const entry = emulator.ledger[txHash + outputIndex];
        assert(entry && !entry.spent);
        const utxo = entry.utxo;
        result.push({
          ...outRef(utxo),
          address: CML.Address.from_bech32(utxo.address).to_hex(),
          lovelace: utxo.assets.lovelace.toString(),
          assets: Object.entries(utxo.assets).filter(([unit]) =>
            unit !== "lovelace"
          ).map(([unit, quantity]) => ({
            policy_id: unit.slice(0, 56),
            asset_name: unit.slice(56),
            quantity: quantity.toString(),
          })),
        });
      }
      return result;
    };
    const body = completed.toTransaction().body();
    const regular = resolve(body.inputs());
    const collateral = resolve(body.collateral_inputs());
    const regularRefs = new Set(
      regular.map((input) => `${input.tx_hash}#${input.output_index}`),
    );
    assert(
      collateral.every((input) =>
        !regularRefs.has(`${input.tx_hash}#${input.output_index}`)
      ),
    );
    return {
      name,
      unsigned_tx_cbor: completed.toCBOR(),
      signer_address: account.address,
      operation: `/ibc.core.client.v1.Msg${
        name === "update" ? "Update" : "Recover"
      }Client`,
      client_id: "07-tendermint-0",
      ...(name === "recovery"
        ? { substitute_client_id: "07-tendermint-1" }
        : {}),
      manifest: {
        consensus_history_format: "proof-backed-v1",
        validators: {
          host_state_stt: {
            address: hostAddress,
            script_hash: hostHash,
            ref_utxo: outRef(references[0]),
          },
          spend_client: {
            address: clientAddress,
            script_hash: clientHash,
            ref_utxo: outRef(clientReference),
          },
          recover_client: {
            script_hash: recoveryHash,
            ref_utxo: outRef(references[2]),
          },
          mint_client_stt: {
            script_hash: clientPolicyId,
            ref_utxo: outRef(references[1]),
          },
        },
        host_state_nft: { policy_id: HOST_POLICY, token_name: HOST_NAME },
      },
      resolved_inputs: {
        regular,
        collateral,
        reference: resolve(body.reference_inputs()),
      },
    };
  }
  let tree = new DeploymentIbcTree();
  tree.set("clients/07-tendermint-0/clientState", encodePublic(clientState));
  tree.set(consensusKey(latestHeight), encodePublic(latestConsensus));
  let historyTree = new DeploymentIbcTree();
  const histories: Constr<Data>[] = [];
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
    const parsed = recordFromConstr(record);
    historyTree.set(
      consensusHistoryKey(parsed.clientToken, parsed.height),
      encodeConsensusHistoryRecord(parsed),
    );
    histories.push(record);
    tree.set(consensusKey(n), encodePublic(historicalConsensus));
  }
  clientDatum.fields.push(await historyTree.getRoot());
  client.datum = encodeStored(clientDatum);
  packet?.seed(seed, account.address);
  packet?.publicLeaves(tree);
  const transactions: HistoryTransaction[] = [];
  const retain = (txHash: string, cbor: string) =>
    transactions.push({
      txHash,
      cbor,
      blockHash: emulator.blockHeight.toString(16).padStart(64, "0"),
      blockHeight: emulator.blockHeight,
      slot: emulator.slot,
      transactionIndex: 0,
    });
  let bootstrap = { txHash: client.txHash, outputIndex: client.outputIndex };
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

  if (createClient) {
    assertEquals(historyCount, 0);
    // Only the HostState NFT is seeded. The deployed client policy creates the
    // client NFT and the HostState script publishes its first public leaves.
    delete emulator.ledger[client.txHash + client.outputIndex];
    const initialTree = new DeploymentIbcTree();
    packet?.publicLeaves(initialTree);
    const initialRoot = await initialTree.getRoot();
    const clientSiblings = await initialTree.getSiblings(
      "clients/07-tendermint-0/clientState",
    );
    initialTree.set(
      "clients/07-tendermint-0/clientState",
      encodePublic(clientState),
    );
    const consensusSiblings = await initialTree.getSiblings(
      consensusKey(latestHeight),
    );
    host.datum = Data.to(
      {
        ...hostDatum,
        state: {
          ...hostDatum.state,
          next_client_sequence: 0n,
          ibc_state_root: initialRoot,
        },
      },
      HostStateDatum,
      { canonical: true },
    );
    hostDatum = { ...hostDatum, state: { ...hostDatum.state, version: 1n } };
    const created = await lucid.newTx().readFrom([references[0], references[1]])
      .collectFrom(
        [host],
        Data.to(
          {
            CreateClient: {
              client_state_siblings: clientSiblings,
              consensus_state_siblings: consensusSiblings,
            },
          },
          HostStateRedeemer,
          { canonical: true },
        ),
      )
      .mintAssets(
        { [clientPolicyId + clientName]: 1n },
        encodeStored(new Constr(0, [])),
      )
      .pay.ToContract(clientAddress, {
        kind: "inline",
        value: encodeStored(clientDatum),
      }, { [clientPolicyId + clientName]: 1n, lovelace: 30_000_000n })
      .pay.ToContract(hostAddress, {
        kind: "inline",
        value: Data.to(hostDatum, HostStateDatum, { canonical: true }),
      }, host.assets)
      .validFrom(now).validTo(now + 30_000).complete({ localUPLCEval: true });
    const signed = await created.sign.withWallet().complete();
    assert(signed.toCBOR().length / 2 <= 16_384 - 750);
    assertEquals(await signed.submit(), signed.toHash());
    emulator.awaitBlock();
    client = await lucid.utxoByUnit(clientPolicyId + clientName);
    host = await lucid.utxoByUnit(HOST_POLICY + HOST_NAME);
    bootstrap = { txHash: client.txHash, outputIndex: client.outputIndex };
    retain(signed.toHash(), signed.toCBOR());
  }

  async function recover(
    mutation?: "missing-history" | "changed-metadata" | "wrong-root",
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
    const substitute = seed(
      clientAddress,
      {
        [clientPolicyId + substituteName]: 1n,
      },
      encodeStored(
        new Constr(0, [nextClientState, substituteToken, "00".repeat(32)]),
      ),
    );
    tree.set(
      "clients/07-tendermint-1/clientState",
      encodePublic(substituteState),
    );
    tree.set(
      `clients/07-tendermint-1/consensusStates/${substituteHeight}`,
      encodePublic(substituteConsensus),
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
      encodePublic(substituteState),
    );
    const consensusSiblings = await tree.getSiblings(
      consensusKey(substituteHeight),
    );
    tree.set(consensusKey(substituteHeight), encodePublic(substituteConsensus));
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
      initialProcessedHeight,
    ]);
    const archivedRecord = recordFromConstr(archived);
    const archivedKey = consensusHistoryKey(
      archivedRecord.clientToken,
      archivedRecord.height,
    );
    const historySiblings = await historyTree.getSiblings(archivedKey);
    historyTree.set(archivedKey, encodeConsensusHistoryRecord(archivedRecord));
    const nextHistoryRoot = await historyTree.getRoot();
    const recoveryReferences = [clientScript].map((script) =>
      seed(account.address, {}, Data.void(), script)
    );
    const builder = newFundedTx().readFrom([
      substitute,
      references[0],
      references[2],
      ...recoveryReferences,
    ])
      .collectFrom(
        [host],
        Data.to(
          {
            UpdateClient: {
              client_state_siblings: clientSiblings,
              consensus_state_siblings: consensusSiblings,
            },
          },
          HostStateRedeemer,
          { canonical: true },
        ),
      )
      .collectFrom(
        [client],
        encodeStored(new Constr(1, [substituteToken, historySiblings])),
      )
      .withdraw(
        rewardAddress,
        0n,
        encodeStored(new Constr(0, [clientToken, substituteToken])),
      )
      .pay.ToContract(clientAddress, {
        kind: "inline",
        value: encodeOutput(
          new Constr(0, [
            nextClientState,
            clientToken,
            mutation === "missing-history"
              ? clientDatum.fields[2]
              : nextHistoryRoot,
          ]),
        ),
      }, client.assets)
      .pay.ToContract(hostAddress, {
        kind: "inline",
        value: Data.to(nextHost, HostStateDatum, { canonical: true }),
      }, host.assets)
      .validFrom(now).validTo(now + 30_000).addSignerKey(signer);

    const completed = await builder.complete({ localUPLCEval: true });
    const signerFixture = signerEvidence(
      "recovery",
      completed,
      recoveryReferences[0],
    );
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
    assertEquals(signed.toTransaction().body().mint(), undefined);
    if (signerFixture) captureSignerFixture!(signerFixture);
    assertEquals(
      (await lucid.utxoByUnit(clientPolicyId + clientName)).datum,
      encodeOutput(
        new Constr(0, [nextClientState, clientToken, nextHistoryRoot]),
      ),
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
    const updateNow = emulator.now();
    const updateNowNs = BigInt(updateNow) * 1_000_000n;
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
    const nextClient = new Constr<Data>(0, [
      new Constr(0, [
        newState,
        new Map([[height(newHeight), newConsensus]]),
        new Map([[
          height(newHeight),
          updateNowNs + (wrongProcessingTime ? 1n : 0n),
        ]]),
        new Map([[height(newHeight), updateNowNs / 4_000_000_000n]]),
      ]),
      clientToken,
    ]);
    const clientSiblings = await tree.getSiblings(
      "clients/07-tendermint-0/clientState",
    );
    tree.set("clients/07-tendermint-0/clientState", encodePublic(newState));
    const consensusSiblings = await tree.getSiblings(consensusKey(newHeight));
    tree.set(consensusKey(newHeight), encodePublic(newConsensus));
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
      initialProcessedHeight,
    ]);
    const archivedRecord = recordFromConstr(archived);
    const archivedKey = consensusHistoryKey(
      archivedRecord.clientToken,
      archivedRecord.height,
    );
    const historySiblings = await historyTree.getSiblings(archivedKey);
    historyTree.set(archivedKey, encodeConsensusHistoryRecord(archivedRecord));
    const nextHistoryRoot = await historyTree.getRoot();
    nextClient.fields.push(nextHistoryRoot);
    const clientReference = seed(
      account.address,
      {},
      Data.void(),
      clientScript,
    );
    const completed = await newFundedTx().readFrom([
      references[0],
      references[2],
      clientReference,
    ])
      .collectFrom(
        [host],
        Data.to(
          {
            UpdateClient: {
              client_state_siblings: clientSiblings,
              consensus_state_siblings: consensusSiblings,
            },
          },
          HostStateRedeemer,
          { canonical: true },
        ),
      )
      .collectFrom(
        [client],
        encodeStored(
          new Constr(0, [adjacentRedeemer.fields[0], [], historySiblings]),
        ),
      )
      .withdraw(rewardAddress, 0n, encodeStored(new Constr(1, [clientToken])))
      .pay.ToContract(clientAddress, {
        kind: "inline",
        value: encodeOutput(nextClient),
      }, client.assets)
      .pay.ToContract(hostAddress, {
        kind: "inline",
        value: Data.to(nextHost, HostStateDatum, { canonical: true }),
      }, host.assets)
      .validFrom(updateNow).validTo(updateNow + 30_000).complete({
        localUPLCEval: true,
      });
    const signerFixture = signerEvidence("update", completed, clientReference);
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
    retain(signed.toHash(), signed.toCBOR());
    if (signerFixture) captureSignerFixture!(signerFixture);
    assertEquals(signed.toTransaction().body().mint(), undefined);
    assertEquals(
      (await lucid.utxoByUnit(clientPolicyId + clientName)).datum,
      encodeOutput(nextClient),
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
      nextClient.fields[2],
    ]);
    const freezeSiblings = await tree.getSiblings(
      "clients/07-tendermint-0/clientState",
    );
    tree.set("clients/07-tendermint-0/clientState", encodePublic(frozenState));
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
      references[2],
      clientReference,
    ])
      .collectFrom(
        [await lucid.utxoByUnit(HOST_POLICY + HOST_NAME)],
        Data.to(
          {
            UpdateClient: {
              client_state_siblings: freezeSiblings,
              consensus_state_siblings: [],
            },
          },
          HostStateRedeemer,
          { canonical: true },
        ),
      )
      .collectFrom(
        [await lucid.utxoByUnit(clientPolicyId + clientName)],
        encodeStored(
          new Constr(0, [adjacentRedeemer.fields[0], [
            new Constr(0, [
              archived,
              await historyTree.getSiblings(archivedKey),
            ]),
          ], []]),
        ),
      )
      .withdraw(rewardAddress, 0n, encodeStored(new Constr(1, [clientToken])))
      .pay.ToContract(clientAddress, {
        kind: "inline",
        value: encodeOutput(frozenClient),
      }, client.assets)
      .pay.ToContract(hostAddress, {
        kind: "inline",
        value: Data.to(frozenHost, HostStateDatum, { canonical: true }),
      }, host.assets)
      .validFrom(emulator.now()).validTo(emulator.now() + 30_000);
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
      clientDatum.fields[2],
    ]);
    const siblings = await tree.getSiblings(
      "clients/07-tendermint-0/clientState",
    );
    tree.set("clients/07-tendermint-0/clientState", encodePublic(frozenState));
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
      references[2],
      clientReference,
    ])
      .collectFrom(
        [host],
        Data.to(
          {
            UpdateClient: {
              client_state_siblings: siblings,
              consensus_state_siblings: [],
            },
          },
          HostStateRedeemer,
          { canonical: true },
        ),
      )
      .collectFrom(
        [client],
        encodeStored(
          new Constr(0, [
            adjacentRedeemer.fields[0],
            [
              new Constr(0, [
                histories[1],
                await historyTree.getSiblings(
                  consensusHistoryKey(
                    recordFromConstr(histories[1]).clientToken,
                    recordFromConstr(histories[1]).height,
                  ),
                ),
              ]),
            ],
            [],
          ]),
        ),
      )
      .withdraw(rewardAddress, 0n, encodeStored(new Constr(1, [clientToken])))
      .pay.ToContract(clientAddress, {
        kind: "inline",
        value: encodeOutput(frozenClient),
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
      encodeOutput(frozenClient),
    );
  }
  return {
    recover,
    update,
    freezeConflictingHeader,
    lucid,
    histories,
    client,
    tree,
    async coldRecoverAndPrune() {
      assert(packet && createClient);
      const directory = await Deno.makeTempDir({
        prefix: "ibc-production-history-",
      });
      const dbPath = `${directory}/history.sqlite`;
      const deployment = {
        layout: "production" as const,
        clientToken: { policyId: clientPolicyId, name: clientName },
        stateAddress: clientAddress,
        bootstrap,
      };
      // The emulator does not retain blocks. This source keeps only CBOR of
      // successfully submitted transactions, with explicitly simulated points.
      const source: HistorySource = {
        async *transactions(after) {
          const start = after
            ? transactions.findIndex((tx) => tx.txHash === after.txHash)
            : 0;
          assert(start >= 0);
          for (const tx of transactions.slice(start)) yield tx;
        },
        currentState: () => lucid.utxoByUnit(clientPolicyId + clientName),
      };
      let recovered = new ConsensusHistoryRecovery(dbPath, deployment);
      try {
        await recovered.recover(source);
        recovered.close();
        for (
          const name of [
            "history.sqlite",
            "history.sqlite-wal",
            "history.sqlite-shm",
          ]
        ) {
          await Deno.remove(`${directory}/${name}`).catch((error) => {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
          });
        }
        // Discard both tree caches and every supplied historical record.
        historyTree = new DeploymentIbcTree();
        tree = new DeploymentIbcTree();
        histories.length = 0;
        recovered = new ConsensusHistoryRecovery(dbPath, deployment);
        const report = await recovered.recover(source);
        const live = await source.currentState();
        assertEquals(report.transactions, 2);
        assertEquals(
          report.root,
          (Data.from(live.datum!) as Constr<Data>).fields[2],
        );
        assertEquals(recovered.current().utxo.txHash, live.txHash);
        assertEquals(recovered.current().utxo.outputIndex, live.outputIndex);
        tree.set(
          "clients/07-tendermint-0/clientState",
          recovered.current().clientValue,
        );
        for await (const entry of recovered.records()) {
          tree.set(
            consensusKey(entry.record.height.revisionHeight),
            entry.consensusValue,
          );
        }
        packet.publicLeaves(tree);
        const liveHost = await lucid.utxoByUnit(HOST_POLICY + HOST_NAME);
        assertEquals(
          await tree.getRoot(),
          Data.from(liveHost.datum!, HostStateDatum).state.ibc_state_root,
        );
        const witness = recovered.witness(deployment.clientToken, {
          revisionNumber: 1n,
          revisionHeight: 2n,
        });
        const result = await packet.prune(
          live,
          liveHost,
          references[0],
          tree,
          witness,
          emulator.now(),
        );
        emulator.awaitBlock();
        await packet.assertPruned();
        assertEquals(
          (await lucid.utxoByUnit(clientPolicyId + clientName)).datum,
          live.datum,
        );
        return { ...result, recoveryMilliseconds: report.milliseconds };
      } finally {
        recovered.close();
        await Deno.remove(directory, { recursive: true });
      }
    },
  };
}

Deno.test("signed recovery commits the expired tip without creating history UTxOs", async () => {
  for (const count of [1, 300]) {
    console.log(JSON.stringify(await (await fixture(count, true)).recover()));
  }
});

Deno.test("signed recovery rejects unchanged history roots, changed metadata and wrong public roots", async () => {
  for (
    const mutation of [
      "missing-history",
      "changed-metadata",
      "wrong-root",
    ] as const
  ) {
    await assertRejects(() =>
      fixture(1, true).then((context) => context.recover(mutation))
    );
  }
});

Deno.test("a signed four-validator header update commits its previous tip without minting", async () => {
  console.log(
    JSON.stringify(await (await fixture(1, false, false, true)).update()),
  );
});

Deno.test("production client mint and header update publish bounded state without archive outputs", async () => {
  for (const canonical of [true, false]) {
    console.log(
      JSON.stringify(
        await (await fixture(
          0,
          false,
          false,
          true,
          true,
          canonical,
          false,
          !canonical,
        )).update(),
      ),
    );
  }
});

Deno.test("a signed header update cannot forge its new processing metadata", async () => {
  const context = await fixture(1, false, false, true);
  await assertRejects(() => context.update(true));
});

Deno.test("a signed conflicting header freezes a client using its authenticated historical trusted height", async () => {
  // The trusted live height3 checkpoint differs from the valid signed height3
  // header. Its height2 trust anchor is an committed history witness.
  await (await fixture(2, false, false, true, false, true, false, false))
    .freezeConflictingHeader();
});

Deno.test("client recovery accepts equivalent input and output CBOR container encodings", async () => {
  await (await fixture(1, true, false, false, false, true, false, false))
    .recover();
});

Deno.test("a production packet uses an old consensus state after deleting all local history", async () => {
  const context = await fixture(0, false, false, true, true, true, true, false);
  console.log(JSON.stringify(await context.update()));
  console.log(JSON.stringify(await context.coldRecoverAndPrune()));
});

// Regenerate the Hermes policy fixtures with:
// IBC_HERMES_SIGNER_FIXTURE=/absolute/output.json deno task test:consensus-history --filter="export Hermes"
// Only accepted transactions are exported. No private keys or script bodies.
const signerFixturePath = Deno.env.get("IBC_HERMES_SIGNER_FIXTURE");
Deno.test({
  name: "export Hermes signer fixtures from accepted production transactions",
  ignore: !signerFixturePath,
  async fn() {
    const cases: Record<string, unknown>[] = [];
    const capture = (value: Record<string, unknown>) => cases.push(value);
    await (await fixture(
      1,
      false,
      false,
      true,
      false,
      true,
      false,
      false,
      capture,
    ))
      .update();
    await (await fixture(
      1,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      capture,
    ))
      .recover();
    assertEquals(cases.length, 2);
    await Deno.writeTextFile(
      signerFixturePath!,
      JSON.stringify(
        {
          source:
            "cardano-ibc-incubator/cardano/offchain/scripts/consensus-history.test.ts",
          cases,
        },
        null,
        2,
      ) + "\n",
    );
  },
});
