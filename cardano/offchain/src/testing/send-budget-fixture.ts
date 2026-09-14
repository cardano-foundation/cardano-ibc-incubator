import { Constr, Data, fromHex, fromText, toHex } from "@lucid-evolution/lucid";
import { blake2b } from "@noble/hashes/blake2b";
import { HostStateDatum, HostStateRedeemer } from "../../types/index.ts";
import { DeploymentIbcTree } from "../deployment.ts";
import { readValidator } from "../utils.ts";
import {
  channelActions,
  channelFixture,
  defaultChannelParameters,
} from "./channel-fixture.ts";

const record = (...fields: Data[]) => new Constr(0, fields);
const variant = (index: number, ...fields: Data[]) => new Constr(index, fields);
const encode = (value: Data) => Data.to(value);
const sha256 = async (hex: string) =>
  toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(fromHex(hex))),
    ),
  );

// Includes the production transfer module and first native escrow-shard mint.
export async function sendPacketFixture() {
  const fixture = await channelFixture(channelActions[2], {
    ...defaultChannelParameters,
    port: "transfer",
    remotePort: "transfer",
    version: "ics20-1",
    ordered: false,
  });
  const {
    lucid,
    emulator,
    seed,
    reference,
    channelScripts,
    channelToken,
    packetContext: context,
  } = fixture;
  const channelPolicy = String(channelToken.fields[0]);
  const [escrowScript, escrowPolicy] = readValidator(
    "minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint",
    lucid,
    [
      record(context.portToken.policy_id, context.portToken.name),
      context.hostPolicy,
    ],
  );
  const [moduleScript, moduleHash, moduleAddress] = readValidator(
    "spending_transfer_module.spend_transfer_module.spend",
    lucid,
    [
      record(context.portToken.policy_id, context.portToken.name),
      record(context.moduleToken.policy_id, context.moduleToken.name),
      fromText("transfer"),
      escrowPolicy,
      channelPolicy,
      "99".repeat(28),
      context.hostPolicy,
      context.shutdownScriptHash,
    ],
  );
  const sequence = 64n;
  const inputDatum = context.channelDatum(3);
  const state = inputDatum.fields[0] as Constr<Data>;
  state.fields[1] = sequence;
  const commitments = state.fields[4] as Map<Data, Data>;
  const tree = new DeploymentIbcTree();
  tree.set(
    "channelEnds/ports/transfer/channels/channel-0",
    encode(state.fields[0]),
  );
  tree.set(
    "nextSequenceSend/ports/transfer/channels/channel-0",
    encode(sequence),
  );
  for (let n = 1n; n < sequence; n++) {
    commitments.set(n, "ab".repeat(32));
    tree.set(
      `commitments/ports/transfer/channels/channel-0/sequences/${n}`,
      encode("ab".repeat(32)),
    );
  }
  const oldRoot = await tree.getRoot();
  const fields = {
    amount: "2000000",
    denom: fromText("lovelace"),
    memo: "budget",
    receiver: "cosmos1receiver",
    sender: "11".repeat(28),
  };
  const transferData = record(
    fromText(fields.denom),
    fromText(fields.amount),
    fromText(fields.sender),
    fromText(fields.receiver),
    fromText(fields.memo),
  );
  const payload = fromText(JSON.stringify(fields));
  const timeout = BigInt(emulator.now() + 120_000) * 1_000_000n;
  const commitment = await sha256(
    timeout.toString(16).padStart(16, "0") + "00".repeat(16) +
      await sha256(payload),
  );
  const packet = record(
    sequence,
    fromText("transfer"),
    fromText("channel-0"),
    fromText("transfer"),
    fromText("channel-7"),
    payload,
    record(0n, 0n),
    timeout,
  );
  const sendKey = "nextSequenceSend/ports/transfer/channels/channel-0";
  const sendSiblings = await tree.getSiblings(sendKey);
  tree.set(sendKey, encode(sequence + 1n));
  const commitmentKey =
    `commitments/ports/transfer/channels/channel-0/sequences/${sequence}`;
  const commitmentSiblings = await tree.getSiblings(commitmentKey);
  tree.set(commitmentKey, encode(commitment));
  const outputDatum = Data.from(encode(inputDatum)) as Constr<Data>;
  const outputState = outputDatum.fields[0] as Constr<Data>;
  outputState.fields[1] = sequence + 1n;
  (outputState.fields[4] as Map<Data, Data>).set(sequence, commitment);
  const registry = new DeploymentIbcTree();
  const emptyRegistryRoot = await registry.getRoot();
  const denom = fromText(fields.denom);
  const channel = fromText("channel-0");
  const shardName = toHex(
    blake2b(
      fromHex(
        fromText("cardano-ibc/transfer-escrow-shard/v1") + "00" +
          (channel.length / 2).toString(16).padStart(8, "0") + channel +
          (denom.length / 2).toString(16).padStart(8, "0") + denom,
      ),
      { dkLen: 28 },
    ),
  );
  const registryKey = `escrowShards/${shardName}`;
  const registrySiblings = await registry.getSiblings(registryKey);
  registry.set(registryKey, "01");
  const module = seed(
    moduleAddress,
    context.module.assets,
    encode(record(emptyRegistryRoot)),
  );
  const hostDatum: HostStateDatum = {
    ...context.hostDatum,
    state: { ...context.hostDatum.state, ibc_state_root: oldRoot },
    control: {
      ...context.hostDatum.control,
      port_registry: new Map([[fromText("transfer"), {
        module_script_hash: moduleHash,
        port_token: context.portToken,
        module_token: context.moduleToken,
      }]]),
    },
  };
  context.host.datum = Data.to(hostDatum, HostStateDatum);
  const newHostDatum: HostStateDatum = {
    ...hostDatum,
    state: {
      ...hostDatum.state,
      version: hostDatum.state.version + 1n,
      ibc_state_root: await tree.getRoot(),
    },
  };
  const hostRedeemer: HostStateRedeemer = {
    HandlePacket: {
      channel_siblings: [],
      next_sequence_send_siblings: sendSiblings,
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: commitmentSiblings,
      packet_receipt_siblings: [],
      packet_acknowledgement_siblings: [],
    },
  };
  const channelUtxo = seed(channelScripts.base.address, {
    lovelace: 20_000_000n,
    [channelPolicy + String(channelToken.fields[1])]: 1n,
  }, encode(inputDatum));
  const operation = channelScripts.referredScripts.send_packet;
  const tx = lucid.newTx()
    .readFrom([
      context.connection,
      context.client,
      reference(context.hostScript),
      reference(channelScripts.base.script),
      reference(operation.script),
      reference(moduleScript),
      reference(escrowScript),
    ])
    .collectFrom([context.host], Data.to(hostRedeemer, HostStateRedeemer))
    .collectFrom([channelUtxo], encode(variant(5, packet)))
    .collectFrom(
      [module],
      encode(
        variant(
          0,
          variant(9, channel, payload, commitment, record(transferData)),
        ),
      ),
    )
    .mintAssets({ [operation.hash]: 1n }, encode(channelToken))
    .mintAssets(
      { [escrowPolicy + shardName]: 1n },
      encode(record(channel, denom, transferData, registrySiblings)),
    )
    .pay.ToContract(context.hostAddress, {
      kind: "inline",
      value: Data.to(newHostDatum, HostStateDatum),
    }, context.host.assets)
    .pay.ToContract(channelScripts.base.address, {
      kind: "inline",
      value: encode(outputDatum),
    }, channelUtxo.assets)
    .pay.ToContract(moduleAddress, {
      kind: "inline",
      value: encode(record(await registry.getRoot())),
    }, module.assets)
    .pay.ToContract(moduleAddress, {
      kind: "inline",
      value: encode(record(channel, denom, 2_000_000n)),
    }, { lovelace: 5_000_000n, [escrowPolicy + shardName]: 1n })
    .validFrom(emulator.now()).validTo(emulator.now() + 60_000);
  return { ...fixture, tx };
}
