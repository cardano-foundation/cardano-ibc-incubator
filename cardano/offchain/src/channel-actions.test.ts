import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  applyDoubleCborEncoding,
  Constr,
  Data,
  fromHex,
  fromText,
  Lucid,
  type Script,
  toHex,
  type UTxO,
  validatorToAddress,
} from "@lucid-evolution/lucid";
import { Emulator, generateEmulatorAccount } from "@lucid-evolution/provider";
import {
  buildChannelValidators,
  DeploymentIbcTree,
  GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
} from "./deployment.ts";
import {
  generatePortTokenName,
  generateTokenName,
  readValidator,
} from "./utils.ts";
import { HostStateDatum, HostStateRedeemer } from "../types/index.ts";

// These are complete, balanced transactions evaluated by Lucid's phase-two
// evaluator. Every script witness comes from the production Aiken blueprint;
// the emulator only seeds the authenticated state preceding each action.
const record = (...fields: Data[]) => new Constr(0, fields);
const variant = (index: number, ...fields: Data[]) => new Constr(index, fields);
const encode = (data: Data) => Data.to(data);
const hash = (byte: string) => byte.repeat(28);
const HEIGHT = record(1n, 10n);
const ZERO_HEIGHT = record(0n, 0n);
const PORT = "mock";
const CHANNEL = "channel-0";
const REMOTE_PORT = "remote";
const REMOTE_CHANNEL = "channel-7";
const CONNECTION = "connection-0";
const REMOTE_CONNECTION = "connection-2";
const VERSION = "mock-version";
const CHANNEL_KEY = "channelEnds/ports/" + PORT + "/channels/" + CHANNEL;
const REMOTE_KEY = "channelEnds/ports/" + REMOTE_PORT + "/channels/" +
  REMOTE_CHANNEL;

const actions = [
  {
    name: "ChanOpenInit",
    create: true,
    before: 0,
    after: 1,
    callback: 0,
    proofState: 0,
  },
  {
    name: "ChanOpenTry",
    create: true,
    before: 0,
    after: 2,
    callback: 1,
    proofState: 1,
  },
  {
    name: "ChanOpenAck",
    policy: "chan_open_ack",
    before: 1,
    after: 3,
    callback: 2,
    proofState: 2,
  },
  {
    name: "ChanOpenConfirm",
    policy: "chan_open_confirm",
    before: 2,
    after: 3,
    callback: 3,
    proofState: 3,
  },
  {
    name: "ChanCloseInit",
    policy: "chan_close_init",
    before: 3,
    after: 4,
    callback: 4,
    proofState: 0,
  },
  {
    name: "ChanCloseConfirm",
    policy: "chan_close_confirm",
    before: 3,
    after: 4,
    callback: 5,
    proofState: 4,
  },
] as const;
type Action = typeof actions[number];

function varint(value: number): string {
  const bytes: number[] = [];
  do {
    const next = value & 0x7f;
    value = Math.floor(value / 128);
    bytes.push(next | (value > 0 ? 0x80 : 0));
  } while (value > 0);
  return toHex(new Uint8Array(bytes));
}

const bytesField = (field: number, value: string) =>
  value.length === 0
    ? ""
    : varint(field * 8 + 2) + varint(value.length / 2) + value;

// Counterparty channel ends are protobuf-encoded for ICS-23 membership.
// Cardano's own HostState tree below commits Aiken's Plutus Data encoding instead.
function counterpartyChannelBytes(action: Action): string {
  const counterparty = bytesField(1, fromText(PORT)) +
    bytesField(2, action.name === "ChanOpenTry" ? "" : fromText(CHANNEL));
  return "08" + varint(action.proofState) + "1002" +
    bytesField(3, counterparty) +
    bytesField(4, fromText(REMOTE_CONNECTION)) +
    bytesField(5, fromText(VERSION));
}

async function sha256(hex: string): Promise<string> {
  return toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(fromHex(hex))),
    ),
  );
}

const leaf = (prefix: string) => record(1n, 0n, 1n, 1n, prefix);
const proofSpecs = [
  record(
    leaf("00"),
    record([0n, 1n], 33n, 4n, 12n, "", 1n),
    0n,
    0n,
    variant(0),
  ),
  record(leaf("00"), record([0n, 1n], 32n, 1n, 1n, "", 1n), 0n, 0n, variant(0)),
];

async function membershipProof(key: string, value: string) {
  const makeLeaf = async (prefix: string, key: string, value: string) =>
    await sha256(
      prefix + varint(key.length / 2) + key + "20" + await sha256(value),
    );
  const innerRoot = await makeLeaf("000202", key, value);
  const root = await makeLeaf("00", fromText("ibc"), innerRoot);
  const existence = (key: string, value: string, prefix: string) =>
    record(variant(0, record(key, value, leaf(prefix), [])));
  return {
    root,
    proof: record([
      existence(key, value, "000202"),
      existence(fromText("ibc"), innerRoot, "00"),
    ]),
  };
}

async function fixture(action: Action) {
  const account = generateEmulatorAccount({ lovelace: 1_000_000_000n });
  const emulator = new Emulator([account]);
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(account.seedPhrase);
  const now = emulator.now();
  const clientPolicy = hash("11");
  const connectionPolicy = hash("22");
  const portPolicy = hash("33");
  const hostPolicy = hash("44");
  const hostToken = { policy_id: hostPolicy, name: fromText("ibc_host_state") };
  const [verifyScript, verifyPolicy] = readValidator(
    "verifying_proof.verify_proof.mint",
    lucid,
  );
  const channelScripts = buildChannelValidators(
    lucid,
    clientPolicy,
    connectionPolicy,
    portPolicy,
    verifyPolicy,
    hostPolicy,
  );
  const [channelMint, channelPolicy] = readValidator(
    "minting_channel_stt.mint_channel_stt.mint",
    lucid,
    [
      clientPolicy,
      connectionPolicy,
      portPolicy,
      verifyPolicy,
      channelScripts.base.hash,
      hostPolicy,
    ],
  );
  const [moduleScript, moduleHash, moduleAddress] = readValidator(
    GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
    lucid,
    [hostPolicy],
  );
  const [hostScript, , hostAddress] = readValidator(
    "host_state_stt.host_state_stt.spend",
    lucid,
    [hostPolicy, hash("55"), hash("66"), channelScripts.base.hash],
  );
  const channelToken = record(
    channelPolicy,
    await generateTokenName(hostToken, fromText("channel"), 0n),
  );
  const clientToken = record(
    clientPolicy,
    await generateTokenName(hostToken, fromText("ibc_client"), 0n),
  );
  const connectionToken = record(
    connectionPolicy,
    await generateTokenName(hostToken, fromText("connection"), 0n),
  );
  const portToken = {
    policy_id: portPolicy,
    name: generatePortTokenName(fromText(PORT)),
  };
  const moduleToken = { policy_id: hash("77"), name: fromText("module") };
  const tokenUnit = (token: Constr<Data>) =>
    String(token.fields[0]) + String(token.fields[1]);

  let outputIndex = 0;
  const seed = (
    address: string,
    assets: Record<string, bigint>,
    datum: string,
    scriptRef?: Script,
  ): UTxO => {
    const utxo = {
      txHash: "ab".repeat(32),
      outputIndex: outputIndex++,
      address,
      assets,
      datum,
      scriptRef,
    };
    emulator.ledger[utxo.txHash + utxo.outputIndex] = { utxo, spent: false };
    return utxo;
  };
  // Provider UTxOs contain the ledger's CBOR-wrapped reference scripts, even
  // when the unparameterized blueprint entry has only one CBOR layer.
  const reference = (script: Script) =>
    seed(account.address, { lovelace: 100_000_000n }, Data.void(), {
      ...script,
      script: applyDoubleCborEncoding(script.script),
    });

  const membership = await membershipProof(
    fromText(REMOTE_KEY),
    counterpartyChannelBytes(action),
  );
  const clientState = record(
    fromText("testchain-1"),
    record(1n, 3n),
    1_209_600_000_000_000n,
    1_814_400_000_000_000n,
    10_000_000_000n,
    ZERO_HEIGHT,
    HEIGHT,
    proofSpecs,
  );
  const consensus = record(
    BigInt(now) * 1_000_000n,
    "00".repeat(32),
    record(membership.root),
  );
  const clientDatum = record(
    record(
      clientState,
      new Map([[HEIGHT, consensus]]),
      new Map([[HEIGHT, 0n]]),
      new Map([[HEIGHT, 0n]]),
    ),
    clientToken,
  );
  const connectionDatum = record(
    record(
      fromText("07-tendermint-0"),
      [record(fromText("1"), [
        fromText("ORDER_ORDERED"),
        fromText("ORDER_UNORDERED"),
      ])],
      variant(3),
      record(
        fromText("07-tendermint-1"),
        fromText(REMOTE_CONNECTION),
        record(fromText("ibc")),
      ),
      0n,
    ),
    connectionToken,
  );
  const client = seed(account.address, {
    lovelace: 5_000_000n,
    [tokenUnit(clientToken)]: 1n,
  }, encode(clientDatum));
  const connection = seed(account.address, {
    lovelace: 5_000_000n,
    [tokenUnit(connectionToken)]: 1n,
  }, encode(connectionDatum));

  const channelEnd = (state: number) =>
    record(
      variant(state),
      variant(2),
      record(
        fromText(REMOTE_PORT),
        state === 1 ? "" : fromText(REMOTE_CHANNEL),
      ),
      [fromText(CONNECTION)],
      fromText(VERSION),
    );
  const channelDatum = (state: number) =>
    record(
      record(
        channelEnd(state),
        1n,
        1n,
        1n,
        new Map(),
        new Map(),
        new Map(),
        ZERO_HEIGHT,
        ZERO_HEIGHT,
      ),
      fromText(PORT),
      channelToken,
    );
  const isCreate = "create" in action;
  const tree = new DeploymentIbcTree();
  // Aiken cbor.serialise uses indefinite-length arrays for committed values.
  if (!isCreate) tree.set(CHANNEL_KEY, Data.to(channelEnd(action.before)));
  const oldRoot = await tree.getRoot();
  const channelSiblings = await tree.getSiblings(CHANNEL_KEY);
  tree.set(CHANNEL_KEY, Data.to(channelEnd(action.after)));
  const sequenceSiblings: string[][] = [];
  if (isCreate) {
    for (
      const prefix of [
        "nextSequenceSend",
        "nextSequenceRecv",
        "nextSequenceAck",
      ]
    ) {
      const key = prefix + "/ports/" + PORT + "/channels/" + CHANNEL;
      sequenceSiblings.push(await tree.getSiblings(key));
      tree.set(key, encode(1n));
    }
  }
  const hostDatum: HostStateDatum = {
    state: {
      version: 1n,
      ibc_state_root: oldRoot,
      next_client_sequence: 1n,
      next_connection_sequence: 1n,
      next_channel_sequence: isCreate ? 0n : 1n,
      bound_port: [],
      last_update_time: BigInt(now),
    },
    nft_policy: hostPolicy,
    deployer: hash("88"),
    control: {
      port_registry: new Map([[fromText(PORT), {
        module_script_hash: moduleHash,
        port_token: portToken,
        module_token: moduleToken,
      }]]),
      shutdown: "Active",
    },
  };
  const newHostDatum: HostStateDatum = {
    ...hostDatum,
    state: {
      ...hostDatum.state,
      version: 2n,
      ibc_state_root: await tree.getRoot(),
      next_channel_sequence: 1n,
    },
  };
  const host = seed(hostAddress, {
    lovelace: 10_000_000n,
    [hostPolicy + hostToken.name]: 1n,
  }, Data.to(hostDatum, HostStateDatum));
  const module = seed(moduleAddress, {
    lovelace: 10_000_000n,
    [portPolicy + portToken.name]: 1n,
    [moduleToken.policy_id + moduleToken.name]: 1n,
  }, Data.void());
  const hostRedeemer: HostStateRedeemer = isCreate
    ? {
      CreateChannel: {
        channel_siblings: channelSiblings,
        next_sequence_send_siblings: sequenceSiblings[0],
        next_sequence_recv_siblings: sequenceSiblings[1],
        next_sequence_ack_siblings: sequenceSiblings[2],
      },
    }
    : { UpdateChannel: { channel_siblings: channelSiblings } };

  let tx = lucid.newTx()
    .readFrom([
      connection,
      client,
      reference(hostScript),
      reference(moduleScript),
    ])
    .collectFrom([host], Data.to(hostRedeemer, HostStateRedeemer))
    .collectFrom(
      [module],
      encode(variant(0, variant(action.callback, fromText(CHANNEL)))),
    )
    .pay.ToContract(hostAddress, {
      kind: "inline",
      value: Data.to(newHostDatum, HostStateDatum),
    }, host.assets)
    .pay.ToContract(
      moduleAddress,
      { kind: "inline", value: module.datum! },
      module.assets,
    )
    .pay.ToContract(channelScripts.base.address, {
      kind: "inline",
      value: encode(channelDatum(action.after)),
    }, { lovelace: 10_000_000n, [tokenUnit(channelToken)]: 1n })
    .validFrom(now).validTo(now + 60_000);

  if (isCreate) {
    const redeemer = action.name === "ChanOpenInit"
      ? variant(0)
      : variant(1, fromText(VERSION), membership.proof, HEIGHT);
    tx = tx.readFrom([reference(channelMint)]).mintAssets({
      [tokenUnit(channelToken)]: 1n,
    }, encode(redeemer));
  } else {
    const channel = seed(channelScripts.base.address, {
      lovelace: 10_000_000n,
      [tokenUnit(channelToken)]: 1n,
    }, encode(channelDatum(action.before)));
    const redeemer = action.name === "ChanOpenAck"
      ? variant(0, fromText(VERSION), membership.proof, HEIGHT)
      : action.name === "ChanOpenConfirm"
      ? variant(1, membership.proof, HEIGHT)
      : action.name === "ChanCloseInit"
      ? variant(6)
      : variant(7, membership.proof, HEIGHT);
    const operation = channelScripts.referredScripts[action.policy];
    tx = tx.readFrom([
      reference(channelScripts.base.script),
      reference(operation.script),
    ])
      .collectFrom([channel], encode(redeemer))
      .mintAssets(
        { [operation.hash]: 1n },
        encode(channelToken),
      );
  }
  if (action.proofState !== 0) {
    const verifyRedeemer = variant(
      0,
      clientState,
      consensus,
      HEIGHT,
      0n,
      0n,
      0n,
      0n,
      membership.proof,
      record([fromText("ibc"), fromText(REMOTE_KEY)]),
      counterpartyChannelBytes(action),
    );
    tx = tx.readFrom([reference(verifyScript)]).mintAssets({
      [verifyPolicy]: 1n,
    }, encode(verifyRedeemer));
  }
  return {
    tx,
    lucid,
    emulator,
    channelToken,
    channelScripts,
    seed,
    reference,
    account,
  };
}

for (const action of actions) {
  Deno.test(
    action.name + " evaluates and submits with the deployed script purposes",
    async () => {
      const { tx, emulator, lucid, channelToken, channelScripts } =
        await fixture(action);
      // Emulator.evaluateTx only echoes budgets. Explicitly enable real UPLC
      // evaluation so a mint routed to an Aiken spend-only script fails this test.
      const completed = await tx.complete({ localUPLCEval: true });
      const signed = await completed.sign.withWallet().complete();
      const txHash = await signed.submit();
      emulator.awaitBlock();
      const outputs = await lucid.utxosAt(channelScripts.base.address);
      assertEquals(outputs.length, 1);
      assertEquals(outputs[0].txHash, txHash);
      assertEquals(
        outputs[0]
          .assets[
            String(channelToken.fields[0]) + String(channelToken.fields[1])
          ],
        1n,
      );
      assert(completed.toTransaction().witness_set().redeemers());
    },
  );
}

for (
  const name of ["chan_open_confirm", "chan_close_init", "chan_close_confirm"]
) {
  Deno.test(name + " rejects execution as a spending validator", async () => {
    const { lucid, channelScripts, seed, reference, account, channelToken } =
      await fixture(actions[4]);
    const operation = channelScripts.referredScripts[name];
    const input = seed(validatorToAddress("Custom", operation.script), {
      lovelace: 10_000_000n,
    }, Data.void());
    await assertRejects(
      () =>
        lucid.newTx().readFrom([reference(operation.script)])
          .collectFrom([input], encode(channelToken))
          .pay.ToAddress(account.address, { lovelace: 5_000_000n })
          .complete({ localUPLCEval: true }),
      Error,
      "failed script execution Spend[",
    );
  });
}
