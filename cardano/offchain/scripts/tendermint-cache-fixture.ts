import { assert, assertEquals } from "@std/assert";
import {
  applyDoubleCborEncoding,
  CML,
  Constr,
  Data,
  fromText,
  getAddressDetails,
  Lucid,
  type Script,
  type TxSigned,
  type UTxO,
  utxoToCore,
  validatorToRewardAddress,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  evaluatedUpdateBudget,
  prepareCachedUpdate,
} from "../src/tendermint-cache-routing.ts";
import { submitHistorySession } from "./consensus-history-staged-fixture.ts";
import { DeploymentIbcTree } from "../src/deployment.ts";
import { generateTokenName, readValidator } from "../src/utils.ts";
import { loadCachedTendermintValidators } from "../src/tendermint-cache-validators.ts";
import { createCardanoScalusEvaluator } from "../src/scalus-evaluator.ts";
import { serialisePlutusData } from "../src/plutus_serialise.ts";
import {
  type CacheLeaf,
  cacheLeafData,
  cacheRecord,
  cacheRecordData,
  compactStateSiblings,
  missedCacheBudgets,
  powerUpdate,
  rotateCache,
  validatorMultiproof,
} from "../src/tendermint-cache.ts";
import { selectTendermintQuorumWitnesses } from "../../gateway/src/tx/tendermint-quorum-witnesses.ts";
import {
  consensusHistoryKey,
  encodeConsensusHistoryRecord,
  recordFromConstr,
} from "../src/consensus_history_commitment.ts";
import { HostStateDatum, HostStateRedeemer } from "../types/index.ts";
import fixture from "../../gateway/src/scripts/test/fixtures/tendermint-update-capacity/normalized.json" with {
  type: "json",
};
import parameters from "./fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};

const c = (fields: Data[], index = 0) => new Constr<Data>(index, fields);
const encode = (value: Data) =>
  Data.to<Data>(value, undefined, { canonical: true });
const publicBytes = (value: Data) => serialisePlutusData(encode(value));
const hostPolicy = "11".repeat(28);
const hostName = fromText("ibc_host_state");
const dummy = "44".repeat(28);

export const retainedScenario = fixture.scenarios.non_adjacent_mixed;
export const retainedLeaves: CacheLeaf[] = retainedScenario.header.validator_set
  .validators.map((v, index) => ({
    index,
    pubkey: v.pub_key.ed25519,
    power: BigInt(v.voting_power),
  }));

export type CacheMutation =
  | "none"
  | "total"
  | "signature"
  | "position"
  | "overlap"
  | "history"
  | "processing"
  | "cache-output"
  | "cache-token"
  | "quorum"
  | "trust"
  | "admission-total"
  | "unrelated-cache"
  | "client-identity"
  | "client-address"
  | "cache-identity"
  | "missing-verifier"
  | "admission-client"
  | "admission-shadow"
  | "admission-missing-cache";

export interface CacheFixtureOptions {
  changedIndices?: number[];
  signerCount?: number;
  historyRecords?: number;
  twoRecords?: boolean;
  routing?: "auto" | "direct";
  directSizeFailure?: boolean;
}

/** Real cache admission and a complete signed update under retained parameters. */
export async function cachedUpdateFixture(
  mode: "hit" | "powers" | "full" | "adjacent" = "hit",
  mutation: CacheMutation = "none",
  options: CacheFixtureOptions = {},
) {
  const scenario = mode === "adjacent"
    ? fixture.scenarios.adjacent_mixed
    : retainedScenario;
  const changed = mode === "powers" || mode === "full";
  const raw = scenario.header.signed_header;
  const h = raw.header;
  const account = generateEmulatorAccount({ lovelace: 2_000_000_000n });
  const emulator = new Emulator([account]);
  emulator.time = Number(BigInt(h.time) / 1_000_000n) + 5_000;
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
  const scripts = loadCachedTendermintValidators(
    lucid,
    hostPolicy,
    "00".repeat(28),
  );
  const [clientScript, clientHash, clientAddress] = scripts.clientSpend;
  const [clientMint, clientPolicy] = scripts.clientMint;
  const [hostScript, , hostAddress] = readValidator(
    "host_state_stt.host_state_stt.spend",
    lucid,
    [hostPolicy, clientHash, dummy, dummy, clientPolicy, dummy, dummy, ""],
    Data.Tuple(
      Array.from({ length: 8 }, () => Data.Bytes()),
    ) as unknown as string[],
  );
  const rewardAddress = validatorToRewardAddress("Preprod", scripts.update[0]);
  const register = await lucid.newTx().register.Stake(rewardAddress).register
    .Stake(
      validatorToRewardAddress(
        "Preprod",
        scripts.staged.updateClient.validator,
      ),
    ).complete();
  await (await register.sign.withWallet().complete()).submit();
  emulator.awaitBlock();
  const clientName = await generateTokenName(
    { policy_id: hostPolicy, name: hostName },
    fromText("ibc_client"),
    0n,
  );
  const clientToken = c([clientPolicy, clientName]);
  const clientUnit = clientPolicy + clientName;
  const cacheName = createHash("sha3-256").update(
    Buffer.from(publicBytes(clientToken), "hex"),
  ).digest("hex");
  const cacheToken = c([scripts.cacheMint[1], cacheName]);
  const cacheUnit = scripts.cacheMint[1] + cacheName;
  const oldLeaves = retainedLeaves.map((leaf) => ({ ...leaf }));
  if (changed) {
    for (const index of options.changedIndices ?? [0, 2]) {
      oldLeaves[index].power -= 1n;
    }
  }
  if (mode === "full") oldLeaves[0].pubkey = "ff".repeat(32);
  const initialRecord = cacheRecord(oldLeaves);
  const additionalSet: CacheLeaf[] = options.twoRecords
    ? [{ index: 0, pubkey: "ab".repeat(32), power: 1n }]
    : [];
  const initialRecords = [
    initialRecord,
    ...(additionalSet.length ? [cacheRecord(additionalSet)] : []),
  ];
  // The changed-set case uses a synthetic trusted bootstrap with the retained
  // public keys and two one-unit power changes. Target signatures are real.
  const trustedRoot = !changed ? h.validators_hash : initialRecord.root;
  const height = (n: bigint) => c([1n, n]);
  const trustedHeight = height(
    BigInt(scenario.header.trusted_height.revision_height),
  );
  const trustedConsensus = c([
    BigInt(scenario.trusted_consensus_state.timestamp),
    trustedRoot,
    c([scenario.trusted_consensus_state.root]),
  ]);
  const now = emulator.now();
  let processingTime = BigInt(now + 30_000) * 1_000_000n;
  const proofSpecs = [[33n, 4n, 12n], [32n, 1n, 1n]].map(([size, min, max]) =>
    c([
      c([1n, 0n, 1n, 1n, "00"]),
      c([[0n, 1n], size, min, max, "", 1n]),
      0n,
      0n,
      c([]),
    ])
  );
  const clientState = c([
    fromText(h.chain_id),
    c(mutation === "trust" ? [9n, 10n] : [1n, 3n]),
    1_209_600_000_000_000n,
    1_814_400_000_000_000n,
    10_000_000_000n,
    c([0n, 0n]),
    trustedHeight,
    proofSpecs,
    [],
  ]);
  const history = new DeploymentIbcTree();
  const clientDatum = c([
    c([
      clientState,
      new Map([[trustedHeight, trustedConsensus]]),
      new Map([[trustedHeight, processingTime]]),
      new Map([[trustedHeight, processingTime / 4_000_000_000n]]),
    ]),
    clientToken,
    await history.getRoot(),
  ]);
  const clientPath = "clients/07-tendermint-0/clientState";
  const consensusPath = (n: bigint) =>
    `clients/07-tendermint-0/consensusStates/1-${n}`;
  const tree = new DeploymentIbcTree();
  const emptyRoot = await tree.getRoot();
  const createClientSiblings = await tree.getSiblings(clientPath);
  tree.set(clientPath, publicBytes(clientState));
  const createConsensusSiblings = await tree.getSiblings(
    consensusPath(trustedHeight.fields[1] as bigint),
  );
  tree.set(
    consensusPath(trustedHeight.fields[1] as bigint),
    publicBytes(trustedConsensus),
  );
  const signer = getAddressDetails(account.address).paymentCredential!.hash;
  let hostDatum: HostStateDatum = {
    state: {
      version: 0n,
      ibc_state_root: emptyRoot,
      next_client_sequence: 0n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: [],
      last_update_time: BigInt(now),
    },
    nft_policy: hostPolicy,
    deployer: signer,
    control: {
      port_registry: new Map(),
      shutdown: "Active",
      live_clients: 0n,
      live_connections: 0n,
      live_channels: 0n,
      last_heartbeat_time: 0n,
    },
  };
  let refIndex = 1;
  const seed = (
    address: string,
    assets: Record<string, bigint>,
    datum: string,
    scriptRef?: Script,
  ): UTxO => {
    const utxo = {
      txHash: (refIndex++).toString(16).padStart(64, "0"),
      outputIndex: 0,
      address,
      assets: { lovelace: 100_000_000n, ...assets },
      datum,
      scriptRef: scriptRef
        ? { ...scriptRef, script: applyDoubleCborEncoding(scriptRef.script) }
        : undefined,
    };
    emulator.ledger[utxo.txHash + utxo.outputIndex] = { utxo, spent: false };
    return utxo;
  };
  const references: UTxO[] = [];
  const publicationBytes: number[] = [];
  for (
    const script of [
      hostScript,
      clientMint,
      scripts.cacheMint[0],
      clientScript,
      scripts.cacheSpend[0],
      scripts.update[0],
    ]
  ) {
    const publication = await lucid.newTx().pay.ToAddressWithData(
      account.address,
      undefined,
      { lovelace: 100_000_000n },
      script,
    ).complete();
    const signed = await publication.sign.withWallet().complete();
    publicationBytes.push(signed.toCBOR().length / 2);
    assert(
      publicationBytes.at(-1)! <= parameters.maxTxSize,
      `reference publication uses ${publicationBytes.at(-1)} bytes`,
    );
    await signed.submit();
    emulator.awaitBlock();
    const outputs = await lucid.utxosByOutRef([{
      txHash: signed.toHash(),
      outputIndex: 0,
    }]);
    assertEquals(outputs.length, 1);
    references.push(outputs[0]);
  }
  processingTime = BigInt(emulator.now() + 30_000) * 1_000_000n;
  (clientDatum.fields[0] as Constr<Data>).fields[2] = new Map([[
    trustedHeight,
    processingTime,
  ]]);
  (clientDatum.fields[0] as Constr<Data>).fields[3] = new Map([[
    trustedHeight,
    processingTime / 4_000_000_000n,
  ]]);
  let host = seed(
    hostAddress,
    { [hostPolicy + hostName]: 1n },
    Data.to(hostDatum, HostStateDatum, { canonical: true }),
  );
  hostDatum = {
    ...hostDatum,
    state: {
      ...hostDatum.state,
      version: 1n,
      next_client_sequence: 1n,
      ibc_state_root: await tree.getRoot(),
    },
    control: { ...hostDatum.control, live_clients: 1n },
  };
  const plutusAddress = c([c([clientHash], 1), c([], 1)]);
  const cacheDatum = c([cacheToken, clientToken, plutusAddress, [
    ...initialRecords.map(cacheRecordData),
  ]]);
  if (mutation === "admission-total") {
    (cacheDatum.fields[3] as Constr<Data>[])[0].fields[2] = 1n;
  }
  const shadow = mutation === "admission-shadow"
    ? readValidator("minting_mock_token.mint_mock_token.mint", lucid)
    : undefined;
  const admissionSubject = shadow ? c([shadow[1], clientName]) : clientToken;
  const admissionName = createHash("sha3-256").update(
    Buffer.from(publicBytes(admissionSubject), "hex"),
  ).digest("hex");
  const admittedCacheToken = c([scripts.cacheMint[1], admissionName]);
  const admittedAddress = mutation === "admission-client"
    ? scripts.cacheSpend[2]
    : clientAddress;
  const admittedHash = mutation === "admission-client"
    ? scripts.cacheSpend[1]
    : clientHash;
  cacheDatum.fields[0] = admittedCacheToken;
  cacheDatum.fields[1] = admissionSubject;
  cacheDatum.fields[2] = c([c([admittedHash], 1), c([], 1)]);
  const admissionBuilder = lucid.newTx().readFrom(references.slice(0, 3))
    .collectFrom(
      [host],
      Data.to(
        {
          CreateClient: {
            client_state_siblings: createClientSiblings,
            consensus_state_siblings: createConsensusSiblings,
          },
        },
        HostStateRedeemer,
        { canonical: true },
      ),
    )
    .mintAssets({ [clientUnit]: 1n }, Data.void())
    .pay.ToContract(admittedAddress, {
      kind: "inline",
      value: encode(clientDatum),
    }, { [clientUnit]: 1n, lovelace: 30_000_000n });
  if (mutation !== "admission-missing-cache") {
    admissionBuilder.mintAssets(
      { [scripts.cacheMint[1] + admissionName]: 1n },
      encode(
        c([
          admissionSubject,
          oldLeaves.map(cacheLeafData),
          additionalSet.map(cacheLeafData),
        ]),
      ),
    )
      .pay.ToContract(scripts.cacheSpend[2], {
        kind: "inline",
        value: encode(cacheDatum),
      }, { [scripts.cacheMint[1] + admissionName]: 1n, lovelace: 5_000_000n });
  }
  if (shadow) {
    admissionBuilder.attach.MintingPolicy(shadow[0]).mintAssets({
      [shadow[1] + clientName]: 1n,
    }, Data.void())
      .pay.ToContract(scripts.cacheSpend[2], {
        kind: "inline",
        value: Data.void(),
      }, { [shadow[1] + clientName]: 1n, lovelace: 5_000_000n });
  }
  admissionBuilder.pay.ToContract(hostAddress, {
    kind: "inline",
    value: Data.to(hostDatum, HostStateDatum, { canonical: true }),
  }, host.assets)
    .validFrom(emulator.now()).validTo(emulator.now() + 30_000);
  const admission = await admissionBuilder.complete({ localUPLCEval: true })
    .catch((error) => {
      throw new Error(`cache admission: ${error}`, { cause: error });
    });
  const signedAdmission = await admission.sign.withWallet().complete();
  const admissionBudget = evaluatedUpdateBudget(signedAdmission, parameters, 0);
  assert(
    admissionBudget.withinLedger,
    `Cache admission exceeds ledger limits: ${JSON.stringify(admissionBudget)}`,
  );
  assertEquals(await signedAdmission.submit(), signedAdmission.toHash());
  emulator.awaitBlock();
  const client = await lucid.utxoByUnit(clientUnit);
  const cache = await lucid.utxoByUnit(cacheUnit);
  host = await lucid.utxoByUnit(hostPolicy + hostName);
  const historicalSnapshot: [string, string][] = [];
  for (let index = 1; index <= (options.historyRecords ?? 0); index++) {
    const record = recordFromConstr(
      c([
        clientToken,
        height((trustedHeight.fields[1] as bigint) - BigInt(index)),
        trustedConsensus,
        processingTime,
        processingTime / 4_000_000_000n,
      ]),
    );
    const key = consensusHistoryKey(record.clientToken, record.height);
    const value = encodeConsensusHistoryRecord(record);
    historicalSnapshot.push([key, value]);
    history.set(key, value);
  }
  if (historicalSnapshot.length) {
    // Assumed authenticated pre-existing history for capacity tests.
    clientDatum.fields[2] = await history.getRoot();
    client.datum = encode(clientDatum);
    emulator.ledger[client.txHash + client.outputIndex].utxo.datum =
      client.datum;
  }
  const voting = (leaf: CacheLeaf) => ({
    pubkey: leaf.pubkey,
    votingPower: leaf.power,
  });
  const selection = selectTendermintQuorumWitnesses({
    targetValidators: retainedLeaves.map(voting),
    commitSignatures: raw.commit.signatures.map((sig) => ({
      block_id_flag: BigInt(sig.block_id_flag),
    })),
    trustedValidators: !changed ? undefined : oldLeaves.map(voting),
    trustLevel: { numerator: 1n, denominator: 3n },
    requireSingleSetTrust: !changed && mode !== "adjacent",
  });
  const selectedIndices = new Set(selection.signatures);
  for (
    let index = retainedLeaves.length - 1;
    selectedIndices.size < (options.signerCount ?? selectedIndices.size) &&
    index >= 0;
    index--
  ) {
    if (Number(raw.commit.signatures[index].block_id_flag) === 2) {
      selectedIndices.add(index);
    }
  }
  const indices = [...selectedIndices].sort((a, b) => a - b);
  if (mutation === "quorum") indices.pop();
  const target = indices.map((index) => retainedLeaves[index]);
  const trustedIndices = !changed
    ? []
    : [...selection.memberships].map((index) =>
      oldLeaves.findIndex((leaf) =>
        leaf.pubkey === retainedLeaves[index].pubkey
      )
    ).sort((a, b) => a - b);
  const trusted = trustedIndices.map((index) => oldLeaves[index]);
  const blockId = (value: typeof h.last_block_id) =>
    c([
      value.hash,
      c([BigInt(value.part_set_header.total), value.part_set_header.hash]),
    ]);
  const tm = c([
    c([BigInt(h.version.block), BigInt(h.version.app)]),
    fromText(h.chain_id),
    BigInt(h.height),
    BigInt(h.time),
    blockId(h.last_block_id),
    h.last_commit_hash,
    h.data_hash,
    h.validators_hash,
    h.next_validators_hash,
    h.consensus_hash,
    h.app_hash,
    h.last_results_hash,
    h.evidence_hash,
    h.proposer_address,
  ]);
  const signatures = indices.map((index) => {
    const sig = raw.commit.signatures[index];
    return c([
      BigInt(sig.block_id_flag),
      sig.validator_address,
      BigInt(sig.timestamp),
      sig.signature,
    ]);
  });
  const signedHeader = c([
    tm,
    c([
      BigInt(raw.commit.height),
      BigInt(raw.commit.round),
      blockId(raw.commit.block_id),
      signatures,
    ]),
  ]);
  const targetSiblings = validatorMultiproof(retainedLeaves, indices);
  const trustedSiblings = trusted.length
    ? validatorMultiproof(oldLeaves, trustedIndices)
    : [];
  const sets = !changed
    ? []
    : mode === "powers"
    ? [powerUpdate(oldLeaves, retainedLeaves)!]
    : [c([retainedLeaves.map(cacheLeafData)])];
  let session: Awaited<ReturnType<typeof submitHistorySession>> | undefined;
  async function initializeStage() {
    if (session) return;
    const validator = (leaf: CacheLeaf) =>
      c([
        createHash("sha256").update(Buffer.from(leaf.pubkey, "hex")).digest(
          "hex",
        ).slice(0, 40),
        leaf.pubkey,
        leaf.power,
        0n,
      ]);
    const validatorSet = (leaves: CacheLeaf[]) =>
      c([
        leaves.map(validator),
        validator(leaves[0]),
        leaves.reduce((total, leaf) => total + leaf.power, 0n),
      ]);
    const sessionReferences = [
      scripts.staged.sessionMint.validator,
      scripts.staged.sessionSpend.validator,
    ].map((script) => seed(account.address, {}, Data.void(), script));
    const fullSignatures = raw.commit.signatures.map((sig) =>
      c([
        BigInt(sig.block_id_flag),
        sig.validator_address,
        BigInt(sig.timestamp),
        sig.signature,
      ])
    );
    const fullSignedHeader = c([
      tm,
      c([
        BigInt(raw.commit.height),
        BigInt(raw.commit.round),
        blockId(raw.commit.block_id),
        fullSignatures,
      ]),
    ]);
    session = await submitHistorySession({
      lucid,
      emulator,
      scripts: scripts.staged,
      batchSize: 24,
      references: sessionReferences,
      clientToken,
      trustedHeight,
      trustedConsensus,
      clientState,
      header: c([
        fullSignedHeader,
        validatorSet(retainedLeaves),
        trustedHeight,
        validatorSet(oldLeaves),
      ]),
      owner: signer,
    });
  }
  let nextClientDatum!: Constr<Data>;
  let nextCacheDatum!: Constr<Data>;
  async function buildCandidate(staged: boolean): Promise<TxSigned> {
    if (staged) await initializeStage();
    const currentTime = emulator.now();
    const tree = new DeploymentIbcTree();
    tree.set(clientPath, publicBytes(clientState));
    tree.set(
      consensusPath(trustedHeight.fields[1] as bigint),
      publicBytes(trustedConsensus),
    );
    const history = new DeploymentIbcTree();
    for (const [key, value] of historicalSnapshot) history.set(key, value);
    const validTo = BigInt(currentTime + 30_000) * 1_000_000n;
    const nextHeight = height(BigInt(h.height));
    const nextState = c([
      ...clientState.fields.slice(0, 6),
      nextHeight,
      proofSpecs,
      [],
    ]);
    const nextConsensus = c([
      BigInt(h.time),
      h.next_validators_hash,
      c([h.app_hash]),
    ]);
    const archived = c([
      clientToken,
      trustedHeight,
      trustedConsensus,
      processingTime,
      processingTime / 4_000_000_000n,
    ]);
    const archivedRecord = recordFromConstr(archived);
    const archivedKey = consensusHistoryKey(
      archivedRecord.clientToken,
      archivedRecord.height,
    );
    const historySiblings = await history.getSiblings(archivedKey);
    history.set(archivedKey, encodeConsensusHistoryRecord(archivedRecord));
    const nextClient = c([
      c([
        nextState,
        new Map([[nextHeight, nextConsensus]]),
        new Map([[
          nextHeight,
          validTo + (mutation === "processing" ? 1n : 0n),
        ]]),
        new Map([[nextHeight, validTo / 4_000_000_000n]]),
      ]),
      clientToken,
      mutation === "history" ? "ff".repeat(32) : await history.getRoot(),
    ]);
    const clientSiblings = await tree.getSiblings(clientPath);
    tree.set(clientPath, publicBytes(nextState));
    const consensusSiblings = await tree.getSiblings(
      consensusPath(BigInt(h.height)),
    );
    tree.set(consensusPath(BigInt(h.height)), publicBytes(nextConsensus));
    const nextHost: HostStateDatum = {
      ...hostDatum,
      state: {
        ...hostDatum.state,
        version: hostDatum.state.version + 1n,
        ibc_state_root: await tree.getRoot(),
      },
    };
    const targetRecord = cacheRecord(retainedLeaves);
    const nextRecords = !changed
      ? initialRecords
      : rotateCache(initialRecords, targetRecord);
    const nextCache = c([
      ...cacheDatum.fields.slice(0, 3),
      nextRecords.map(cacheRecordData),
    ]);
    if (mutation === "cache-output") {
      (nextCache.fields[3] as Constr<Data>[])[0].fields[2] = 1n;
    }
    if (mutation === "client-identity") nextCache.fields[1] = c([dummy, "99"]);
    if (mutation === "client-address") {
      nextCache.fields[2] = c([c([dummy], 1), c([], 1)]);
    }
    if (mutation === "cache-identity") {
      nextCache.fields[0] = c([scripts.cacheMint[1], "99".repeat(32)]);
    }
    if (mutation === "total") {
      // Corrupt authenticated fixture state solely to isolate denominator checks.
      // A legitimate admission cannot create this datum.
      const forged = Data.from(cache.datum!) as Constr<Data>;
      (forged.fields[3] as Constr<Data>[])[0].fields[2] =
        targetRecord.totalPower * 2n;
      cache.datum = encode(forged);
      emulator.ledger[cache.txHash + cache.outputIndex].utxo.datum =
        cache.datum;
    }
    if (mutation === "signature") signatures[0].fields[3] = "00".repeat(64);
    const targetData = target.map(cacheLeafData);
    if (mutation === "position") {
      targetData[1].fields[0] = targetData[0].fields[0];
    }
    let suppliedCacheToken = cacheToken;
    if (mutation === "unrelated-cache") {
      const unrelatedClient = c([clientPolicy, "99"]);
      const unrelatedName = createHash("sha3-256").update(
        Buffer.from(publicBytes(unrelatedClient), "hex"),
      ).digest("hex");
      suppliedCacheToken = c([scripts.cacheMint[1], unrelatedName]);
      const forged = Data.from(cache.datum!) as Constr<Data>;
      forged.fields[0] = suppliedCacheToken;
      // Model the claimed identity after an unauthorized historical handoff.
      forged.fields[1] = clientToken;
      (forged.fields[3] as Constr<Data>[])[0].fields[2] = 1n;
      delete cache.assets[cacheUnit];
      cache.assets[scripts.cacheMint[1] + unrelatedName] = 1n;
      cache.datum = encode(forged);
      emulator.ledger[cache.txHash + cache.outputIndex].utxo = cache;
      nextCache.fields[0] = suppliedCacheToken;
    }
    const update = c([
      mutation === "cache-token" ? c([dummy, cacheName]) : suppliedCacheToken,
      signedHeader,
      trustedHeight,
      targetData,
      targetSiblings,
      mutation === "overlap" ? [] : trusted.map(cacheLeafData),
      mutation === "overlap" ? [] : trustedSiblings,
      sets,
      compactStateSiblings(historySiblings),
    ]);
    const updateReference = session
      ? seed(
        account.address,
        {},
        Data.void(),
        scripts.staged.updateClient.validator,
      )
      : references[5];
    const builder = lucid.newTx().readFrom([
      references[0],
      references[3],
      references[4],
      updateReference,
    ])
      .collectFrom(
        [host],
        Data.to(
          {
            UpdateClient: {
              client_state_siblings: compactStateSiblings(clientSiblings),
              consensus_state_siblings: compactStateSiblings(consensusSiblings),
            },
          },
          HostStateRedeemer,
          { canonical: true },
        ),
      )
      .collectFrom(
        [client],
        session
          ? encode(
            c([session.token, [], compactStateSiblings(historySiblings)]),
          )
          : encode(c([update], 6)),
      )
      .collectFrom([cache], Data.void());
    if (mutation !== "missing-verifier") {
      builder.withdraw(
        session
          ? validatorToRewardAddress(
            "Preprod",
            scripts.staged.updateClient.validator,
          )
          : rewardAddress,
        0n,
        session ? encode(c([clientToken], 4)) : encode(clientToken),
      );
    }
    builder
      .pay.ToContract(clientAddress, {
        kind: "inline",
        value: encode(nextClient),
      }, client.assets)
      .pay.ToContract(scripts.cacheSpend[2], {
        kind: "inline",
        value: encode(nextCache),
      }, cache.assets)
      .pay.ToContract(hostAddress, {
        kind: "inline",
        value: Data.to(nextHost, HostStateDatum, { canonical: true }),
      }, host.assets)
      .validFrom(currentTime).validTo(currentTime + 30_000);
    const completed = await (session ? session.finalize(builder) : builder)
      .complete({ localUPLCEval: true }).catch((error) => {
        throw new Error(`cached update: ${error}`, { cause: error });
      });
    const signed = await completed.sign.withWallet().complete();
    nextClientDatum = nextClient;
    nextCacheDatum = nextCache;
    return signed;
  }
  const submittedTransactions = new Set<string>();
  const originalSubmit = emulator.submitTx.bind(emulator);
  emulator.submitTx = (cbor) => {
    submittedTransactions.add(cbor);
    return originalSubmit(cbor);
  };
  let rejectedDirectCbor: string | undefined;
  let directFee: number | undefined;
  const prepared = mode === "full"
    ? undefined
    : mutation === "none" && options.routing !== "direct"
    ? await prepareCachedUpdate({
      direct: async () => {
        if (options.directSizeFailure) {
          throw new Error(
            "Max transaction size of 16384 exceeded. Found: 16400",
          );
        }
        const signed = await buildCandidate(false);
        directFee = Number(signed.toTransaction().body().fee());
        rejectedDirectCbor = signed.toCBOR();
        return signed;
      },
      staged: () => buildCandidate(true),
      limits: parameters,
      headroomPercent: 5,
    })
    : undefined;
  const signed = prepared?.transaction ?? await buildCandidate(mode === "full");
  const budget = evaluatedUpdateBudget(
    signed,
    parameters,
    mutation === "none" ? 5 : 0,
  );
  assert(
    budget.fits,
    `Candidate exceeds complete-transaction budgets: ${JSON.stringify(budget)}`,
  );
  const units = CML.compute_total_ex_units(
    signed.toTransaction().witness_set().redeemers()!,
  );
  let referencedScriptBytes = 0;
  const refs = signed.toTransaction().body().reference_inputs()!;
  for (let i = 0; i < refs.len(); i++) {
    const ref = refs.get(i);
    referencedScriptBytes += utxoToCore(
      emulator.ledger[ref.transaction_id().to_hex() + Number(ref.index())]
        .utxo,
    ).output().script_ref()?.as_plutus_v3()?.to_raw_bytes().length ?? 0;
  }
  assertEquals(await signed.submit(), signed.toHash());
  emulator.awaitBlock();
  assertEquals(
    (await lucid.utxoByUnit(clientUnit)).datum,
    encode(nextClientDatum),
  );
  assertEquals(
    (await lucid.utxoByUnit(cacheUnit)).datum,
    encode(nextCacheDatum),
  );
  if (!session) assertEquals(signed.toTransaction().body().mint(), undefined);
  assertEquals((await lucid.utxosAt(scripts.cacheSpend[2])).length, 1);
  if (prepared?.path === "staged") {
    assert(
      !submittedTransactions.has(rejectedDirectCbor!),
      "Rejected direct candidate must never be submitted",
    );
  }
  const redeemerBudgets = [];
  const redeemers = signed.toTransaction().witness_set().redeemers()!
    .to_flat_format();
  for (let i = 0; i < redeemers.len(); i++) {
    const redeemer = redeemers.get(i);
    let script = redeemer.tag() === CML.RedeemerTag.Reward
      ? (session ? "update_staged_client" : "update_cached_client")
      : "session_mint";
    if (redeemer.tag() === CML.RedeemerTag.Spend) {
      const input = signed.toTransaction().body().inputs().get(
        Number(redeemer.index()),
      );
      const consumed = [host, client, cache, ...(session ? [session.utxo] : [])]
        .find((utxo) =>
          utxo.txHash === input.transaction_id().to_hex() &&
          utxo.outputIndex === Number(input.index())
        );
      assert(consumed, "Script input must belong to the measured operation");
      const address = consumed.address;
      script = address === hostAddress
        ? "host_state_stt"
        : address === clientAddress
        ? "spending_cached_client"
        : address === scripts.cacheSpend[2]
        ? "spending_validator_cache"
        : "session_spend";
    }
    redeemerBudgets.push({
      script,
      tag: redeemer.tag(),
      index: Number(redeemer.index()),
      memory: Number(redeemer.ex_units().mem()),
      steps: Number(redeemer.ex_units().steps()),
    });
  }
  const measured = {
    signedBytes: signed.toCBOR().length / 2,
    referencedScriptBytes,
    memory: Number(units.mem()),
    steps: Number(units.steps()),
    fee: Number(signed.toTransaction().body().fee()),
  };
  assert(measured.signedBytes <= parameters.maxTxSize);
  assert(
    measured.memory <= parameters.maxTxExMem,
    JSON.stringify({ measured, redeemerBudgets }),
  );
  assert(measured.steps <= parameters.maxTxExSteps);
  return {
    mode,
    path: session ? "staged" as const : "direct" as const,
    directBudget: prepared?.directBudget,
    directFee,
    directFailure: prepared && "directFailure" in prepared
      ? prepared.directFailure
      : undefined,
    rejectedDirectWasSubmitted: prepared?.path === "staged"
      ? submittedTransactions.has(rejectedDirectCbor!)
      : undefined,
    historyRecords: historicalSnapshot.length,
    cacheRecords: initialRecords.length,
    changedIndices: changed ? options.changedIndices ?? [0, 2] : [],
    measured,
    completeFee: measured.fee +
      (session?.measurements.reduce((sum, tx) => sum + tx.fee, 0) ?? 0),
    updateTransactions: 1 + (session?.measurements.length ?? 0),
    redeemerBudgets,
    publicationBytes,
    missedBudgets: missedCacheBudgets({
      ...measured,
      fee: measured.fee +
        (session?.measurements.reduce((sum, tx) => sum + tx.fee, 0) ?? 0),
    }),
    signatures: target.length,
    targetSiblings: targetSiblings.length,
    trustedSiblings: trustedSiblings.length,
    admissionFee: Number(signedAdmission.toTransaction().body().fee()),
    admissionBudget,
    signedCbor: signed.toCBOR(),
    fallbackSessions: session?.measurements,
  };
}
