import { blake2b } from "@noble/hashes/blake2b";
import { assert, assertEquals } from "@std/assert";
import {
  Constr,
  credentialToAddress,
  Data,
  fromHex,
  fromText,
  getAddressDetails,
  toHex,
  type UTxO,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { HostStateDatum, HostStateRedeemer } from "../../types/index.ts";
import { DeploymentIbcTree } from "../deployment.ts";
import { membershipProof } from "./channel-fixture.ts";
import { assertPacketInventories } from "./funds-oracle.ts";
import { absenceProof } from "./packet-budget-fixture.ts";
import { type sendPacketFixture } from "./send-budget-fixture.ts";

const record = (...fields: Data[]) => new Constr(0, fields);
const variant = (index: number, ...fields: Data[]) => new Constr(index, fields);
const encode = (value: Data) => Data.to(value);
// Data.to's Cardano-node normalization sorts map keys. Channel receipts are
// Aiken Pairs and prepend new entries, so preserve their insertion order in
// this schema's two record constructors. Data.from preserves encoded order.
function encodeChannel(datum: Constr<Data>): string {
  const state = datum.fields[0] as Constr<Data>;
  const receipts = state.fields[5] as Map<Data, Data>;
  const receiptBytes = "bf" +
    [...receipts].map(([key, value]) => encode(key) + encode(value)).join("") +
    "ff";
  const stateBytes = "d8799f" +
    state.fields.map((field, index) =>
      index === 5 ? receiptBytes : encode(field)
    )
      .join("") +
    "ff";
  return "d8799f" + stateBytes + datum.fields.slice(1).map(encode).join("") +
    "ff";
}
const nonzero = (assets: Record<string, bigint>) =>
  Object.fromEntries(Object.entries(assets).filter(([, n]) => n !== 0n));
const withVoucherObligation = (
  datum: string,
  delta: bigint,
) => {
  const [registryRoot, obligation] = (Data.from(datum) as Constr<Data>).fields;
  assertEquals(typeof obligation, "bigint");
  return encode(record(registryRoot, (obligation as bigint) + delta));
};
const HEIGHT = record(1n, 10n);
const local = "ports/transfer/channels/channel-0";
const remote = "ports/transfer/channels/channel-7";
const sha256 = async (hex: string) =>
  toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(fromHex(hex))),
    ),
  );
export type FundsFixture = Awaited<ReturnType<typeof sendPacketFixture>>;
export interface VoucherInfo {
  base: string;
  full: string;
  unit: string;
  metadata: UTxO;
  owner: string;
  address: string;
  seedPhrase: string;
}

export interface FundsPacket {
  packet: Constr<Data>;
  data: Constr<Data>;
  amount: bigint;
}
export type Settlement = "ack" | "error" | "timeout";
export type FundsMutation =
  | "none"
  | "short"
  | "excess"
  | "wrong_callback"
  | "wrong_proof"
  | "wrong_recipient";

export function firstPacket(fixture: FundsFixture): FundsPacket {
  return {
    packet: fixture.funds.packet,
    data: fixture.funds.transferData,
    amount: fixture.funds.parameters.amount,
  };
}

async function current(f: FundsFixture) {
  const host = await f.lucid.utxoByUnit(
    f.packetContext.hostPolicy + fromText("ibc_host_state"),
  );
  const channel = await f.lucid.utxoByUnit(
    String(f.channelToken.fields[0]) + String(f.channelToken.fields[1]),
  );
  const escrow = await f.lucid.utxoByUnit(
    f.funds.escrowPolicy + f.funds.shardName,
  );
  const module = await f.lucid.utxoByUnit(
    f.packetContext.moduleToken.policy_id + f.packetContext.moduleToken.name,
  );
  const datum = Data.from(channel.datum!) as Constr<Data>;
  const state = datum.fields[0] as Constr<Data>;
  const tree = new DeploymentIbcTree();
  tree.set(`channelEnds/${local}`, encode(state.fields[0]));
  tree.set(`nextSequenceSend/${local}`, encode(state.fields[1]));
  for (const [n, hash] of state.fields[4] as Map<Data, Data>) {
    tree.set(`commitments/${local}/sequences/${n}`, encode(hash));
  }
  for (const [n, value] of state.fields[5] as Map<Data, Data>) {
    tree.set(`receipts/${local}/sequences/${n}`, encode(value));
  }
  for (const [n, value] of state.fields[6] as Map<Data, Data>) {
    tree.set(`acks/${local}/sequences/${n}`, encode(value));
  }
  const hostDatum = Data.from(host.datum!, HostStateDatum);
  assertEquals(
    await tree.getRoot(),
    hostDatum.state.ibc_state_root,
    "input tree must describe submitted state",
  );
  return { host, channel, escrow, module, datum, state, tree, hostDatum };
}

// This harness assumes an independently authenticated counterparty consensus
// state. It does not claim to model Tendermint updates; funds, channel and host
// state are always read from the outputs of the preceding submitted transaction.
function counterparty(f: FundsFixture, root: string, timestamp?: bigint) {
  const c = f.packetContext;
  c.consensus.fields[2] = record(root);
  if (timestamp !== undefined) c.consensus.fields[0] = timestamp;
  c.client.datum = encode(c.clientDatum);
}

function emptyHostRedeemer(): Extract<
  HostStateRedeemer,
  { HandlePacket: unknown }
> {
  return {
    HandlePacket: {
      channel_siblings: [],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [],
      packet_receipt_siblings: [],
      packet_acknowledgement_siblings: [],
    },
  };
}

export async function nextSend(
  f: FundsFixture,
  amount: bigint,
  mutation: FundsMutation = "none",
  voucher?: VoucherInfo,
) {
  const c = await current(f);
  const sequence = c.state.fields[1] as bigint;
  const fields = {
    amount: amount.toString(),
    denom: voucher?.full ?? (f.funds.parameters.asset || fromText("lovelace")),
    memo: f.funds.parameters.memo,
    receiver: f.funds.parameters.receiver,
    sender: voucher?.owner ?? f.funds.parameters.sender,
  };
  const payload = fromText(JSON.stringify(fields));
  const data = record(
    ...[
      fields.denom,
      fields.amount,
      fields.sender,
      fields.receiver,
      fields.memo,
    ].map(fromText),
  );
  const timeout = BigInt(f.emulator.now() + 120_000) * 1_000_000n;
  const commitment = await sha256(
    timeout.toString(16).padStart(16, "0") + "00".repeat(16) +
      await sha256(payload),
  );
  const packet = record(
    sequence,
    fromText("transfer"),
    f.funds.channel,
    fromText("transfer"),
    fromText("channel-7"),
    payload,
    record(0n, 0n),
    timeout,
  );
  const hostRedeemer = emptyHostRedeemer();
  hostRedeemer.HandlePacket.next_sequence_send_siblings = await c.tree
    .getSiblings(`nextSequenceSend/${local}`);
  c.tree.set(`nextSequenceSend/${local}`, encode(sequence + 1n));
  const key = `commitments/${local}/sequences/${sequence}`;
  hostRedeemer.HandlePacket.packet_commitment_siblings = await c.tree
    .getSiblings(key);
  c.tree.set(key, encode(commitment));
  c.state.fields[1] = sequence + 1n;
  (c.state.fields[4] as Map<Data, Data>).set(sequence, commitment);
  const escrowDatum = Data.from(c.escrow.datum!) as Constr<Data>;
  const delta = amount +
    (mutation === "short" ? -1n : mutation === "excess" ? 1n : 0n);
  escrowDatum.fields[2] = (escrowDatum.fields[2] as bigint) + delta;
  const escrowAssets = {
    ...c.escrow.assets,
    [f.funds.assetUnit]: (c.escrow.assets[f.funds.assetUnit] ?? 0n) + delta,
  };
  const callback = variant(
    0,
    variant(
      9,
      f.funds.channel,
      mutation === "wrong_callback" ? fromText("wrong") : payload,
      commitment,
      record(data),
    ),
  );
  const operation = f.channelScripts.referredScripts.send_packet;
  const newHost = {
    ...c.hostDatum,
    state: {
      ...c.hostDatum.state,
      version: c.hostDatum.state.version + 1n,
      ibc_state_root: await c.tree.getRoot(),
    },
  };
  let tx = f.lucid.newTx()
    .readFrom([
      f.packetContext.connection,
      f.packetContext.client,
      f.reference(f.packetContext.hostScript),
      f.reference(f.channelScripts.base.script),
      f.reference(operation.script),
      f.reference(f.funds.moduleScript),
    ])
    .collectFrom([c.host], Data.to(hostRedeemer, HostStateRedeemer))
    .collectFrom([c.channel], encode(variant(5, packet)))
    .collectFrom(voucher ? [c.module] : [c.module, c.escrow], encode(callback))
    .mintAssets({ [operation.hash]: 1n }, encode(f.channelToken))
    .pay.ToContract(f.packetContext.hostAddress, {
      kind: "inline",
      value: Data.to(newHost, HostStateDatum),
    }, c.host.assets)
    .pay.ToContract(f.channelScripts.base.address, {
      kind: "inline",
      value: encodeChannel(c.datum),
    }, c.channel.assets)
    .pay.ToContract(f.funds.moduleAddress, {
      kind: "inline",
      value: c.module.datum!,
    }, c.module.assets)
    .validFrom(f.emulator.now()).validTo(f.emulator.now() + 60_000);
  if (voucher) {
    tx = tx.readFrom([f.reference(f.funds.voucherScript)])
      .mintAssets(
        { [voucher.unit]: -delta },
        encode(variant(1, fromText("transfer"), f.funds.channel, data)),
      );
  } else {
    tx = tx.pay.ToContract(f.funds.moduleAddress, {
      kind: "inline",
      value: encode(escrowDatum),
    }, nonzero(escrowAssets));
  }
  return { tx, emulator: f.emulator, sent: { packet, data, amount } };
}

export async function settle(
  f: FundsFixture,
  sent: FundsPacket,
  kind: Settlement,
  mutation: FundsMutation = "none",
  voucher?: VoucherInfo,
) {
  const c = await current(f);
  const sequence = sent.packet.fields[0] as bigint;
  const key = `commitments/${local}/sequences/${sequence}`;
  const hostRedeemer = emptyHostRedeemer();
  hostRedeemer.HandlePacket.packet_commitment_siblings = await c.tree
    .getSiblings(key);
  c.tree.set(key, "");
  (c.state.fields[4] as Map<Data, Data>).delete(sequence);
  const timeout = kind === "timeout";
  const refund = kind !== "ack";
  const voucherRefundAmount = sent.amount +
    (mutation === "short" ? -1n : mutation === "excess" ? 1n : 0n);
  const ack = timeout
    ? ""
    : fromText(kind === "ack" ? '{"result":"AQ=="}' : '{"error":"failed"}');
  const ackData = record(
    variant(
      kind === "ack" ? 0 : 1,
      fromText(kind === "ack" ? "AQ==" : "failed"),
    ),
  );
  const proofKey = fromText(
    `${timeout ? "receipts" : "acks"}/${remote}/sequences/${sequence}`,
  );
  const proofValue = timeout ? "" : await sha256(ack);
  const proof = timeout
    ? await absenceProof(proofKey)
    : await membershipProof(proofKey, proofValue);
  counterparty(
    f,
    mutation === "wrong_proof" ? "00".repeat(32) : proof.root,
    timeout ? sent.packet.fields[7] as bigint : undefined,
  );
  const channelRedeemer = timeout
    ? variant(3, sent.packet, proof.proof, HEIGHT, 1n)
    : variant(4, sent.packet, ack, proof.proof, HEIGHT);
  const payload = mutation === "wrong_callback"
    ? fromText("wrong packet")
    : sent.packet.fields[5];
  const callback = variant(
    0,
    timeout
      ? variant(7, f.funds.channel, payload, record(sent.data))
      : variant(8, f.funds.channel, payload, ackData, record(sent.data)),
  );
  const operation = timeout
    ? f.channelScripts.referredScripts.timeout_packet
    : f.channelScripts.referredScripts.acknowledge_packet;
  const verify = variant(
    timeout ? 1 : 0,
    f.packetContext.clientState,
    f.packetContext.consensus,
    HEIGHT,
    0n,
    0n,
    0n,
    0n,
    proof.proof,
    record([fromText("ibc"), proofKey]),
    ...(timeout ? [] : [proofValue]),
  );
  const newHost = {
    ...c.hostDatum,
    state: {
      ...c.hostDatum.state,
      version: c.hostDatum.state.version + 1n,
      ibc_state_root: await c.tree.getRoot(),
    },
  };
  let tx = f.lucid.newTx()
    .readFrom([
      f.packetContext.connection,
      f.packetContext.client,
      f.reference(f.packetContext.hostScript),
      f.reference(f.channelScripts.base.script),
      f.reference(operation.script),
      f.reference(f.funds.moduleScript),
      f.reference(f.packetContext.verifyScript),
    ])
    .collectFrom([c.host], Data.to(hostRedeemer, HostStateRedeemer))
    .collectFrom([c.channel], encode(channelRedeemer))
    .collectFrom([c.module], encode(callback))
    .mintAssets({ [operation.hash]: 1n }, encode(f.channelToken))
    .mintAssets(
      { [f.packetContext.verifyPolicy]: 1n },
      encode(record(verify, variant(1))),
    )
    .pay.ToContract(f.packetContext.hostAddress, {
      kind: "inline",
      value: Data.to(newHost, HostStateDatum),
    }, c.host.assets)
    .pay.ToContract(f.channelScripts.base.address, {
      kind: "inline",
      value: encodeChannel(c.datum),
    }, c.channel.assets)
    .pay.ToContract(
      f.funds.moduleAddress,
      {
        kind: "inline",
        value: !refund && voucher
          ? withVoucherObligation(c.module.datum!, -sent.amount)
          : c.module.datum!,
      },
      c.module.assets,
    );
  if (refund && !voucher) {
    const escrowDatum = Data.from(c.escrow.datum!) as Constr<Data>;
    escrowDatum.fields[2] = (escrowDatum.fields[2] as bigint) - sent.amount;
    const assets = {
      ...c.escrow.assets,
      [f.funds.assetUnit]: c.escrow.assets[f.funds.assetUnit] - sent.amount,
    };
    const payout = sent.amount +
      (mutation === "short" ? -1n : mutation === "excess" ? 1n : 0n);
    const receiver = credentialToAddress("Custom", {
      type: "Key",
      hash: mutation === "wrong_recipient"
        ? "aa".repeat(28)
        : f.funds.parameters.sender,
    });
    tx = tx.collectFrom([c.escrow], encode(callback))
      .pay.ToContract(f.funds.moduleAddress, {
        kind: "inline",
        value: encode(escrowDatum),
      }, nonzero(assets))
      .pay.ToAddress(
        receiver,
        f.funds.parameters.asset
          ? nonzero({ lovelace: 2_000_000n, [f.funds.assetUnit]: payout })
          : { lovelace: payout },
      );
  }
  if (refund && voucher) {
    const minted = voucherRefundAmount;
    tx = tx.readFrom([voucher.metadata, f.reference(f.funds.voucherScript)])
      .mintAssets(
        { [voucher.unit]: minted },
        encode(
          variant(
            2,
            fromText("transfer"),
            f.funds.channel,
            sent.data,
            timeout ? variant(1) : variant(0, ackData),
          ),
        ),
      )
      .pay.ToAddress(
        credentialToAddress("Custom", {
          type: "Key",
          hash: mutation === "wrong_recipient"
            ? "aa".repeat(28)
            : voucher.owner,
        }),
        { lovelace: 2_000_000n, [voucher.unit]: minted },
      );
  }
  return {
    tx: tx.validFrom(f.emulator.now()).validTo(f.emulator.now() + 60_000),
    emulator: f.emulator,
  };
}

export async function assertFundsState(
  f: FundsFixture,
  expectedEscrow: bigint,
  pending: FundsPacket[],
  history: { nextSend: bigint; transitions: bigint; received: bigint[] },
  expectedVoucherObligation = 0n,
) {
  const c = await current(f);
  const escrowDatum = Data.from(c.escrow.datum!) as Constr<Data>;
  assertEquals(escrowDatum.fields[2], expectedEscrow);
  assertEquals(
    c.escrow.assets[f.funds.assetUnit] ?? 0n,
    expectedEscrow +
      (f.funds.parameters.asset ? 0n : f.funds.parameters.reserve),
  );
  assertEquals(
    c.escrow.assets.lovelace,
    f.funds.parameters.reserve +
      (f.funds.parameters.asset ? 0n : expectedEscrow),
  );
  assertPacketInventories(c.state, pending, history.received);
  assertEquals(c.module.assets, f.packetContext.module.assets);
  assertEquals(
    c.module.datum,
    encode(record(await f.funds.registry.getRoot(), expectedVoucherObligation)),
  );
  const initial = f.funds.channelDatum.fields[0] as Constr<Data>;
  assertEquals(c.datum.fields.slice(1), f.funds.channelDatum.fields.slice(1));
  for (const index of [0, 2, 3, 7]) {
    assertEquals(c.state.fields[index], initial.fields[index]);
  }
  assertEquals(c.state.fields[1], history.nextSend);
  assertEquals(c.hostDatum, {
    ...f.funds.hostDatum,
    state: {
      ...f.funds.hostDatum.state,
      version: f.funds.hostDatum.state.version + history.transitions,
      ibc_state_root: c.hostDatum.state.ibc_state_root,
    },
  });
  assertEquals(c.channel.assets.lovelace, 20_000_000n);
  assertEquals(c.host.assets, f.packetContext.host.assets);
  assert(expectedEscrow >= 0n);
}

export async function receiverBalance(f: FundsFixture): Promise<bigint> {
  const receiver = credentialToAddress("Custom", {
    type: "Key",
    hash: f.funds.parameters.sender,
  });
  const outputs: UTxO[] = await f.lucid.utxosAt(receiver);
  return outputs.reduce(
    (sum, u) => sum + (u.assets[f.funds.assetUnit] ?? 0n),
    0n,
  );
}

export async function receiveNative(
  f: FundsFixture,
  amount: bigint,
  sequence: bigint,
  mutation: FundsMutation = "none",
  voucher?: VoucherInfo,
) {
  const c = await current(f);
  const fields = {
    amount: amount.toString(),
    denom: voucher?.base ?? ("transfer/channel-7/" +
      (f.funds.parameters.asset || fromText("lovelace"))),
    memo: f.funds.parameters.memo,
    receiver: voucher?.owner ?? f.funds.parameters.sender,
    sender: "cosmos1remote",
  };
  const payload = fromText(JSON.stringify(fields));
  const data = record(
    ...[
      fields.denom,
      fields.amount,
      fields.sender,
      fields.receiver,
      fields.memo,
    ].map(fromText),
  );
  const timeout = BigInt(f.emulator.now() + 120_000) * 1_000_000n;
  const commitment = await sha256(
    timeout.toString(16).padStart(16, "0") + "00".repeat(16) +
      await sha256(payload),
  );
  const packet = record(
    sequence,
    fromText("transfer"),
    fromText("channel-7"),
    fromText("transfer"),
    f.funds.channel,
    payload,
    record(0n, 0n),
    timeout,
  );
  const proofKey = fromText(`commitments/${remote}/sequences/${sequence}`);
  const proof = await membershipProof(proofKey, commitment);
  counterparty(f, mutation === "wrong_proof" ? "00".repeat(32) : proof.root);
  const ack = record(variant(0, fromText("AQ==")));
  const ackHash = await sha256(fromText('{"result":"AQ=="}'));
  const callback = variant(
    0,
    variant(
      6,
      f.funds.channel,
      mutation === "wrong_callback" ? fromText("wrong") : payload,
      ack,
      record(data),
    ),
  );
  const receiptKey = `receipts/${local}/sequences/${sequence}`;
  const ackKey = `acks/${local}/sequences/${sequence}`;
  const hostRedeemer = emptyHostRedeemer();
  hostRedeemer.HandlePacket.packet_receipt_siblings = await c.tree.getSiblings(
    receiptKey,
  );
  c.tree.set(receiptKey, encode(""));
  hostRedeemer.HandlePacket.packet_acknowledgement_siblings = await c.tree
    .getSiblings(ackKey);
  c.tree.set(ackKey, encode(ackHash));
  c.state.fields[5] = new Map([
    [sequence, ""],
    ...(c.state.fields[5] as Map<Data, Data>),
  ]);
  (c.state.fields[6] as Map<Data, Data>).set(sequence, ackHash);
  c.state.fields[8] = HEIGHT;
  const newHost = {
    ...c.hostDatum,
    state: {
      ...c.hostDatum.state,
      version: c.hostDatum.state.version + 1n,
      ibc_state_root: await c.tree.getRoot(),
    },
  };
  const escrowDatum = Data.from(c.escrow.datum!) as Constr<Data>;
  escrowDatum.fields[2] = (escrowDatum.fields[2] as bigint) - amount;
  const escrowAssets = {
    ...c.escrow.assets,
    [f.funds.assetUnit]: c.escrow.assets[f.funds.assetUnit] - amount,
  };
  const payout = amount +
    (mutation === "short" ? -1n : mutation === "excess" ? 1n : 0n);
  const receiver = credentialToAddress("Custom", {
    type: "Key",
    hash: mutation === "wrong_recipient"
      ? "aa".repeat(28)
      : (voucher?.owner ?? f.funds.parameters.sender),
  });
  const operation = f.channelScripts.referredScripts.recv_packet;
  let tx = f.lucid.newTx()
    .readFrom([
      f.packetContext.connection,
      f.packetContext.client,
      f.reference(f.packetContext.hostScript),
      f.reference(f.channelScripts.base.script),
      f.reference(operation.script),
      f.reference(f.funds.moduleScript),
      f.reference(f.packetContext.verifyScript),
    ])
    .collectFrom([c.host], Data.to(hostRedeemer, HostStateRedeemer))
    .collectFrom([c.channel], encode(variant(2, packet, proof.proof, HEIGHT)))
    .collectFrom(voucher ? [c.module] : [c.module, c.escrow], encode(callback))
    .mintAssets({ [operation.hash]: 1n }, encode(f.channelToken))
    .mintAssets(
      { [f.packetContext.verifyPolicy]: 1n },
      encode(
        record(
          variant(
            0,
            f.packetContext.clientState,
            f.packetContext.consensus,
            HEIGHT,
            0n,
            0n,
            0n,
            0n,
            proof.proof,
            record([fromText("ibc"), proofKey]),
            commitment,
          ),
          variant(1),
        ),
      ),
    )
    .pay.ToContract(f.packetContext.hostAddress, {
      kind: "inline",
      value: Data.to(newHost, HostStateDatum),
    }, c.host.assets)
    .pay.ToContract(f.channelScripts.base.address, {
      kind: "inline",
      value: encodeChannel(c.datum),
    }, c.channel.assets)
    .pay.ToContract(
      f.funds.moduleAddress,
      {
        kind: "inline",
        value: voucher
          ? withVoucherObligation(c.module.datum!, payout)
          : c.module.datum!,
      },
      c.module.assets,
    )
    .pay.ToAddress(
      receiver,
      voucher
        ? { lovelace: 2_000_000n, [voucher.unit]: payout }
        : f.funds.parameters.asset
        ? nonzero({ lovelace: 2_000_000n, [f.funds.assetUnit]: payout })
        : { lovelace: payout },
    )
    .validFrom(f.emulator.now()).validTo(f.emulator.now() + 60_000);
  if (voucher) {
    tx = tx.readFrom([voucher.metadata, f.reference(f.funds.voucherScript)])
      .mintAssets(
        { [voucher.unit]: payout },
        encode(
          variant(
            0,
            fromText("transfer"),
            fromText("channel-7"),
            fromText("transfer"),
            f.funds.channel,
            data,
          ),
        ),
      );
  } else {
    tx = tx.pay.ToContract(f.funds.moduleAddress, {
      kind: "inline",
      value: encode(escrowDatum),
    }, nonzero(escrowAssets));
  }
  return { tx, emulator: f.emulator };
}

// Seed a previously registered trace, with the real CIP-68 metadata witness.
// First-seen trace registration remains covered by its contract regressions.
export async function knownVoucher(
  f: FundsFixture,
  base: string,
  seedPhrase = f.account.seedPhrase,
): Promise<VoucherInfo> {
  const full = `transfer/channel-0/${base}`;
  const hash = toHex(blake2b(fromHex(fromText(full)), { dkLen: 28 }));
  const name = "0014df10" + hash;
  const unit = f.funds.voucherPolicy + name;
  const display = new Map<Data, Data>([[fromText("name"), fromText(base)], [
    fromText("ticker"),
    fromText(base),
  ], [fromText("description"), fromText(`IBC voucher for ${full}`)]]);
  const extra = new Map<Data, Data>([
    [fromText("path"), fromText("transfer/channel-0")],
    [fromText("baseDenom"), fromText(base)],
    [fromText("fullDenom"), fromText(full)],
    [fromText("ibcDenomHash"), fromText(await sha256(fromText(full)))],
    [fromText("traceVersion"), 1n],
    [fromText("voucherPolicyId"), fromText(f.funds.voucherPolicy)],
    [fromText("voucherTokenName"), fromText(name)],
  ]);
  const metadata = f.seed(f.funds.metadataAddress, {
    lovelace: 3_000_000n,
    [f.funds.voucherPolicy + "000643b0" + hash]: 1n,
  }, Data.to<Data>(record(display, 1n, extra), undefined, { canonical: true }));
  const wallet = walletFromSeed(seedPhrase, {
    network: "Custom",
    addressType: "Enterprise",
  });
  const owner = getAddressDetails(wallet.address).paymentCredential!.hash;
  f.lucid.selectWallet.fromSeed(seedPhrase, {
    addressType: "Enterprise",
  });
  const address = await f.lucid.wallet().address();
  f.account.address = address;
  f.seed(address, { lovelace: 1_000_000_000n }, Data.void());
  return { base, full, unit, metadata, owner, address, seedPhrase };
}
