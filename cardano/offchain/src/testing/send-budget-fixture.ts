import {
  Constr,
  credentialToAddress,
  Data,
  fromHex,
  fromText,
  type Script,
  toHex,
  type UTxO,
} from "@lucid-evolution/lucid";
import { isolateEvaluation } from "./isolated-evaluation.ts";
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

export interface SendParameters {
  amount: bigint;
  reserve: bigint;
  sequence: bigint;
  receiver: string;
  sender: string;
  memo: string;
  // Empty means ADA; otherwise this is a native policy/name unit.
  asset: string;
  unrelated?: bigint;
}
export type SendMutation =
  | "none"
  | "short_escrow"
  | "excess_escrow"
  | "wrong_callback"
  | "wrong_commitment";
export const defaultSendParameters: SendParameters = {
  amount: 2_000_000n,
  reserve: 3_000_000n,
  sequence: 64n,
  receiver: "cosmos1receiver",
  sender: "11".repeat(28),
  memo: "budget",
  asset: "",
};

// Includes the production transfer module and first native escrow-shard mint.
export async function sendPacketFixture(
  parameters: SendParameters = defaultSendParameters,
  mutation: SendMutation = "none",
) {
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
    reference: seedReference,
    channelScripts,
    channelToken,
    packetContext: context,
  } = fixture;
  isolateEvaluation(lucid, emulator);
  // Histories reuse immutable reference scripts. Creating wallet-owned copies
  // for every mutation otherwise grows coin-selection input and WASM memory
  // throughout a case, and lets fee selection spend future script references.
  const references = new Map<string, UTxO>();
  const referenceAddress = credentialToAddress("Custom", {
    type: "Script",
    hash: "fe".repeat(28),
  });
  const reference = (script: Script): UTxO => {
    const key = `${script.type}:${script.script}`;
    let utxo = references.get(key);
    if (!utxo) {
      utxo = seedReference(script);
      utxo.address = referenceAddress;
      references.set(key, utxo);
    }
    return utxo;
  };
  if (parameters.unrelated) {
    context.host.assets["cd".repeat(28) + "617578"] = parameters.unrelated;
    // Module capability witnesses permit only their two authentication assets.
    // Vary their ADA reserve while placing unrelated tokens on HostState.
    context.module.assets.lovelace += parameters.unrelated;
  }
  const channelPolicy = String(channelToken.fields[0]);
  // Replace the channel-opening seed state with the transfer scenario. Keep
  // authenticated units unique when later operations query submitted outputs.
  const channelUnit = channelPolicy + String(channelToken.fields[1]);
  const moduleUnit = context.moduleToken.policy_id + context.moduleToken.name;
  for (const [key, entry] of Object.entries(emulator.ledger)) {
    if (entry.utxo.assets[channelUnit] || entry.utxo.assets[moduleUnit]) {
      delete emulator.ledger[key];
    }
  }

  const [escrowScript, escrowPolicy] = readValidator(
    "minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint",
    lucid,
    [
      record(context.portToken.policy_id, context.portToken.name),
      context.hostPolicy,
    ],
  );
  const [, metadataHash, metadataAddress] = readValidator(
    "voucher_metadata.voucher_metadata.spend",
    lucid,
    [context.hostPolicy],
  );
  const [voucherScript, voucherPolicy] = readValidator(
    "minting_voucher.mint_voucher.mint",
    lucid,
    [
      record(context.moduleToken.policy_id, context.moduleToken.name),
      record("77".repeat(28), fromText("directory")),
      metadataHash,
      channelPolicy,
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
      voucherPolicy,
      context.hostPolicy,
      context.shutdownScriptHash,
    ],
  );
  const sequence = parameters.sequence;
  const assetUnit = parameters.asset || "lovelace";
  if (parameters.asset) {
    seed(fixture.account.address, {
      lovelace: 20_000_000n,
      [assetUnit]: 1_000_000_000n,
    }, Data.void());
  }
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
    amount: parameters.amount.toString(),
    denom: parameters.asset || fromText("lovelace"),
    memo: parameters.memo,
    receiver: parameters.receiver,
    sender: parameters.sender,
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
  const escrowAmount = parameters.amount +
    (mutation === "short_escrow"
      ? -1n
      : mutation === "excess_escrow"
      ? 1n
      : 0n);
  const escrowAssets: Record<string, bigint> = {
    lovelace: parameters.reserve,
    [escrowPolicy + shardName]: 1n,
  };
  escrowAssets[assetUnit] = (escrowAssets[assetUnit] ?? 0n) + escrowAmount;
  for (const unit of Object.keys(escrowAssets)) {
    if (escrowAssets[unit] === 0n) delete escrowAssets[unit];
  }
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
          variant(
            9,
            channel,
            mutation === "wrong_callback" ? fromText("wrong payload") : payload,
            mutation === "wrong_commitment" ? "00".repeat(32) : commitment,
            record(transferData),
          ),
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
      value: encode(record(channel, denom, escrowAmount)),
    }, escrowAssets)
    .validFrom(emulator.now()).validTo(emulator.now() + 60_000);
  return {
    ...fixture,
    reference,
    tx,
    funds: {
      voucherScript,
      voucherPolicy,
      metadataAddress,
      parameters,
      assetUnit,
      moduleScript,
      moduleHash,
      moduleAddress,
      escrowScript,
      escrowPolicy,
      shardName,
      channel,
      denom,
      tree,
      registry,
      hostDatum: newHostDatum,
      channelDatum: outputDatum,
      packet,
      transferData,
      payload,
      commitment,
      escrowAmount: parameters.amount,
    },
  };
}
