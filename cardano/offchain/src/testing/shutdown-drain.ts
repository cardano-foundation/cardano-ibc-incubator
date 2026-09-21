import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
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
import { blake2b } from "@noble/hashes/blake2b";
import {
  HostStateDatum,
  HostStateRedeemer,
  ModuleRegistrationSchema,
} from "../../types/plutus/index.ts";
import { DeploymentIbcTree } from "../deployment.ts";
import { generateTokenName } from "../utils.ts";
import {
  assertStateDrained,
  buildReclaimEscrowTx,
  buildReclaimStateTx,
  escrowDatum,
  scanDeploymentState,
} from "../shutdown.ts";
import {
  clientStateWithHistory,
  deploymentScenario,
} from "./shutdown-model.ts";
import { membershipProof } from "./channel-fixture.ts";
import { absenceProof } from "./packet-budget-fixture.ts";

const record = (...fields: Data[]) => new Constr(0, fields);
const variant = (index: number, ...fields: Data[]) => new Constr(index, fields);
const encode = (value: Data) => Data.to(value);
const sha256 = async (hex: string) =>
  toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(fromHex(hex))),
    ),
  );
const height = record(1n, 10n);
const localChannel = fromText("channel-0");
const port = fromText("transfer");
const localPath = "ports/transfer/channels/channel-0";
const denom = fromText(fromText("lovelace"));
const packetCommitment = async (packet: Constr<Data>) => {
  const timeoutHeight = packet.fields[6] as Constr<Data>;
  const uint64 = (value: Data) =>
    (value as bigint).toString(16).padStart(16, "0");
  return await sha256(
    uint64(packet.fields[7]) + timeoutHeight.fields.map(uint64).join("") +
      await sha256(packet.fields[5] as string),
  );
};
export type DrainMode = "timeout" | "error-ack" | "return";
export interface DrainCase {
  mode: DrainMode;
  amount: bigint;
  graceDays: number;
  settleNearDeadline?: boolean;
  settleAfterGrace?: boolean;
}

/**
 * Start from an assumed active IBC history on a real deployment. Fund every
 * snapshot output from the existing wallet, preserving the genesis ADA oracle.
 * From shutdown entry onward, every state change is a submitted transaction.
 */
export async function checkShutdownDrain(
  {
    mode,
    amount,
    graceDays,
    settleNearDeadline = false,
    settleAfterGrace = false,
  }: DrainCase,
) {
  const f = await deploymentScenario();
  const { lucid, emulator, deployment } = f;
  const v = deployment.validators;
  const recipientKey = getAddressDetails(
    walletFromSeed(
      "legal winner thank year wave sausage worth useful legal winner thank yellow",
      { network: "Custom" },
    ).address,
  ).paymentCredential!.hash;
  const recipient = credentialToAddress("Custom", {
    type: "Key",
    hash: recipientKey,
  });
  try {
    const hostInput = await f.host();
    const hostDatum = await f.hostDatum();
    assertEquals(hostDatum.control.shutdown, "Active");
    const nft = async (prefix: string, policy: string) =>
      record(
        policy,
        await generateTokenName(
          {
            policy_id: deployment.hostStateNFT!.policyId,
            name: deployment.hostStateNFT!.name,
          },
          fromText(prefix),
          0n,
        ),
      );
    const clientToken = await nft("ibc_client", v.mintClientStt.scriptHash);
    const connectionToken = await nft(
      "connection",
      v.mintConnectionStt.scriptHash,
    );
    const channelToken = await nft("channel", v.mintChannelStt.scriptHash);
    const unit = (token: Constr<Data>) =>
      String(token.fields[0]) + String(token.fields[1]);
    const payloadFields = {
      amount: amount.toString(),
      denom: mode === "return"
        ? `transfer/channel-7/${fromText("lovelace")}`
        : fromText("lovelace"),
      memo: "shutdown drain",
      receiver: mode === "return" ? recipientKey : "cosmos1receiver",
      sender: mode === "return" ? "cosmos1sender" : recipientKey,
    };
    const payload = fromText(JSON.stringify(payloadFields));
    const transferData = record(
      ...[
        payloadFields.denom,
        payloadFields.amount,
        payloadFields.sender,
        payloadFields.receiver,
        payloadFields.memo,
      ].map(fromText),
    );
    const timeout = BigInt(emulator.now() + 7 * 86_400_000) * 1_000_000n;
    const timeoutHeight = mode === "timeout" ? record(1n, 9n) : record(0n, 0n);
    const packet = record(
      1n,
      port,
      fromText(mode === "return" ? "channel-7" : "channel-0"),
      port,
      fromText(mode === "return" ? "channel-0" : "channel-7"),
      payload,
      timeoutHeight,
      timeout,
    );
    const commitment = await packetCommitment(packet);
    const errorAck = fromText('{"error":"rejected"}');
    const successAck = fromText('{"result":"AQ=="}');
    const remoteKey = fromText(
      `${
        mode === "timeout"
          ? "receipts"
          : mode === "error-ack"
          ? "acks"
          : "commitments"
      }/ports/transfer/channels/channel-7/sequences/1`,
    );
    const proofValue = mode === "error-ack"
      ? await sha256(errorAck)
      : commitment;
    const proof = mode === "timeout"
      ? await absenceProof(remoteKey)
      : await membershipProof(remoteKey, proofValue);
    const client = clientStateWithHistory([10], emulator.now(), proof.root);
    const connection = record(
      fromText("07-tendermint-0"),
      [record(fromText("1"), [
        fromText("ORDER_ORDERED"),
        fromText("ORDER_UNORDERED"),
      ])],
      variant(3),
      record(
        fromText("07-tendermint-7"),
        fromText("connection-7"),
        record(fromText("ibc")),
      ),
      0n,
    );
    const channelState = record(
      record(variant(3), variant(1), record(port, fromText("channel-7")), [
        fromText("connection-0"),
      ], fromText("ics20-1")),
      2n,
      1n,
      1n,
      new Map(mode === "return" ? [] : [[1n, commitment]]),
      new Map(),
      new Map(),
      record(0n, 0n),
      record(0n, 0n),
    );
    const channelDatum = record(channelState, port, channelToken);
    const tree = new DeploymentIbcTree();
    for (const [key, registration] of hostDatum.control.port_registry) {
      const text = new TextDecoder().decode(fromHex(key));
      tree.set(
        `ports/${text}`,
        Data.to(registration as never, ModuleRegistrationSchema as never),
      );
    }
    tree.set("clients/07-tendermint-0/clientState", encode(client.client));
    tree.set(
      "clients/07-tendermint-0/consensusStates/10",
      encode(client.consensus),
    );
    tree.set("connections/connection-0", encode(connection));
    tree.set(`channelEnds/${localPath}`, encode(channelState.fields[0]));
    for (
      const [i, key] of [
        "nextSequenceSend",
        "nextSequenceRecv",
        "nextSequenceAck",
      ].entries()
    ) {
      tree.set(`${key}/${localPath}`, encode(channelState.fields[i + 1]));
    }
    if (mode !== "return") {
      tree.set(`commitments/${localPath}/sequences/1`, encode(commitment));
    }
    const root = await lucid.utxoByUnit(deployment.modules.transfer.identifier);
    const shardName = toHex(
      blake2b(
        fromHex(
          fromText("cardano-ibc/transfer-escrow-shard/v1") + "00" +
            (localChannel.length / 2).toString(16).padStart(8, "0") +
            localChannel + (denom.length / 2).toString(16).padStart(8, "0") +
            denom,
        ),
        { dkLen: 28 },
      ),
    );
    const shardUnit = v.mintTransferEscrowShard.scriptHash + shardName;
    const registry = new DeploymentIbcTree();
    registry.set(`escrowShards/${shardName}`, "01");
    let snapshotIndex = 0;
    const snapshot = (
      address: string,
      assets: Record<string, bigint>,
      datum: string,
    ) => {
      const u: UTxO = {
        txHash: "dd".repeat(32),
        outputIndex: snapshotIndex++,
        address,
        assets,
        datum,
      };
      emulator.ledger[u.txHash + u.outputIndex] = { utxo: u, spent: false };
      return u;
    };
    // This is the only ledger seeding point. No ADA is introduced by the snapshot.
    const funding = (await emulator.getUtxos(f.address)).sort((a, b) =>
      a.assets.lovelace > b.assets.lovelace ? -1 : 1
    )[0];
    const snapshotAda = 20_000_000n + amount;
    assert(funding.assets.lovelace > snapshotAda + 2_000_000n);
    funding.assets.lovelace -= snapshotAda;
    const clientUtxo = snapshot(v.spendClient.address, {
      lovelace: 5_000_000n,
      [unit(clientToken)]: 1n,
    }, encode(record(client.state, clientToken, "00".repeat(32))));
    const connectionUtxo = snapshot(v.spendConnection.address, {
      lovelace: 5_000_000n,
      [unit(connectionToken)]: 1n,
    }, encode(record(connection, connectionToken)));
    snapshot(v.spendChannel.address, {
      lovelace: 5_000_000n,
      [unit(channelToken)]: 1n,
    }, encode(channelDatum));
    snapshot(v.spendTransferModule.address, {
      lovelace: 5_000_000n + amount,
      [shardUnit]: 1n,
    }, encode(record(localChannel, denom, amount)));
    root.datum = encode(record(await registry.getRoot(), 0n));
    hostInput.datum = Data.to(
      {
        ...hostDatum,
        state: {
          ...hostDatum.state,
          ibc_state_root: await tree.getRoot(),
          next_client_sequence: 1n,
          next_connection_sequence: 1n,
          next_channel_sequence: 1n,
        },
      },
      HostStateDatum,
      { canonical: true },
    );
    lucid.overrideUTxOs(await emulator.getUtxos(f.address));
    emulator.awaitSlot(61);
    assertEquals(escrowDatum(await lucid.utxoByUnit(shardUnit)).amount, amount);

    // Evaluate the same deposit builder on both sides of EnterShutdown. This
    // prevents an unrelated malformed transaction from satisfying the rejection.
    const newDeposit = async () => {
      const host = await f.host();
      const currentHost = await f.hostDatum();
      const channel = await lucid.utxoByUnit(unit(channelToken));
      const shard = await lucid.utxoByUnit(shardUnit);
      const nextChannel = Data.from(channel.datum!) as Constr<Data>;
      const state = nextChannel.fields[0] as Constr<Data>;
      const sequence = state.fields[1] as bigint;
      const fields = {
        ...payloadFields,
        denom: fromText("lovelace"),
        sender: recipientKey,
        receiver: "cosmos1receiver",
      };
      const data = fromText(JSON.stringify(fields));
      const packet = record(
        sequence,
        port,
        localChannel,
        port,
        fromText("channel-7"),
        data,
        record(0n, 0n),
        BigInt(emulator.now() + 7 * 86_400_000) * 1_000_000n,
      );
      const commitment = await packetCommitment(packet);
      const transfer = record(
        ...[
          fields.denom,
          fields.amount,
          fields.sender,
          fields.receiver,
          fields.memo,
        ].map(fromText),
      );
      const sendKey = `nextSequenceSend/${localPath}`;
      const commitmentKey = `commitments/${localPath}/sequences/${sequence}`;
      const sendSiblings = await tree.getSiblings(sendKey);
      tree.set(sendKey, encode(sequence + 1n));
      const commitmentSiblings = await tree.getSiblings(commitmentKey);
      tree.set(commitmentKey, encode(commitment));
      try {
        state.fields[1] = sequence + 1n;
        (state.fields[4] as Map<Data, Data>).set(sequence, commitment);
        const operation = v.spendChannel.refValidator!.send_packet;
        return lucid.newTx().readFrom([
          root,
          clientUtxo,
          connectionUtxo,
          v.hostStateStt.refUtxo,
          v.spendChannel.refUtxo,
          operation.refUtxo,
          v.spendTransferModule.refUtxo,
        ])
          .collectFrom(
            [host],
            Data.to({
              HandlePacket: {
                channel_siblings: [],
                next_sequence_send_siblings: sendSiblings,
                next_sequence_recv_siblings: [],
                next_sequence_ack_siblings: [],
                packet_commitment_siblings: commitmentSiblings,
                packet_receipt_siblings: [],
                packet_acknowledgement_siblings: [],
              },
            }, HostStateRedeemer),
          )
          .collectFrom([channel], encode(variant(5, packet)))
          .collectFrom(
            [shard],
            encode(
              record(
                variant(9, localChannel, data, commitment, record(transfer)),
              ),
            ),
          )
          .mintAssets({ [operation.scriptHash]: 1n }, encode(channelToken))
          .pay.ToContract(host.address, {
            kind: "inline",
            value: Data.to(
              {
                ...currentHost,
                state: {
                  ...currentHost.state,
                  version: currentHost.state.version + 1n,
                  last_update_time: BigInt(emulator.now()),
                  ibc_state_root: await tree.getRoot(),
                },
              },
              HostStateDatum,
              { canonical: true },
            ),
          }, host.assets)
          .pay.ToContract(channel.address, {
            kind: "inline",
            value: encode(nextChannel),
          }, channel.assets)
          .pay.ToContract(shard.address, {
            kind: "inline",
            value: encode(record(localChannel, denom, amount * 2n)),
          }, { ...shard.assets, lovelace: shard.assets.lovelace + amount })
          .validFrom(emulator.now()).validTo(emulator.now() + 60_000);
      } finally {
        tree.set(sendKey, encode(sequence));
        tree.set(commitmentKey, "");
      }
    };
    await (await newDeposit()).complete({ localUPLCEval: true });

    await f.enter(graceDays);
    await assertRejects(
      async () =>
        await (await newDeposit()).complete({ localUPLCEval: true }),
      Error,
      "failed script execution",
    );
    await f.rejectPrematureCleanup();
    if (settleNearDeadline) await f.rejectPrematureCleanup(1);
    assert((await f.hostDatum()).control.shutdown !== "Active");
    const groups = await scanDeploymentState(lucid, deployment);
    assertThrows(
      () => assertStateDrained(groups, deployment),
      Error,
      mode === "return" ? "user deposits" : "unsettled packets",
    );
    if (settleAfterGrace) {
      await f.waitForGrace();
      for (const kind of ["client", "connection"] as const) {
        const dependency = groups.find((group) => group.kind === kind)!;
        const reclaim = buildReclaimStateTx(
          lucid,
          deployment,
          await f.host(),
          dependency,
          f.address,
          emulator.now(),
          await lucid.utxoByUnit(deployment.modules.transfer.identifier),
        );
        await assertRejects(
          () => reclaim.complete({ localUPLCEval: true }),
          Error,
          "failed script execution",
        );
      }
    }
    const host = await f.host();
    const currentHost = await f.hostDatum();
    const channel = await lucid.utxoByUnit(unit(channelToken));
    const shard = await lucid.utxoByUnit(shardUnit);
    const nextChannel = Data.from(channel.datum!) as Constr<Data>;
    const state = nextChannel.fields[0] as Constr<Data>;
    const witnesses = {
      channel_siblings: [] as string[],
      next_sequence_send_siblings: [],
      next_sequence_recv_siblings: [],
      next_sequence_ack_siblings: [],
      packet_commitment_siblings: [] as string[],
      packet_receipt_siblings: [] as string[],
      packet_acknowledgement_siblings: [] as string[],
    };
    if (mode === "return") {
      const ackCommitment = await sha256(successAck);
      (state.fields[5] as Map<Data, Data>).set(1n, "");
      (state.fields[6] as Map<Data, Data>).set(1n, ackCommitment);
      state.fields[8] = height;
      witnesses.packet_receipt_siblings = await tree.getSiblings(
        `receipts/${localPath}/sequences/1`,
      );
      tree.set(`receipts/${localPath}/sequences/1`, encode(""));
      witnesses.packet_acknowledgement_siblings = await tree.getSiblings(
        `acks/${localPath}/sequences/1`,
      );
      tree.set(`acks/${localPath}/sequences/1`, encode(ackCommitment));
    } else {
      (state.fields[4] as Map<Data, Data>).delete(1n);
      witnesses.packet_commitment_siblings = await tree.getSiblings(
        `commitments/${localPath}/sequences/1`,
      );
      tree.set(`commitments/${localPath}/sequences/1`, "");
    }
    const operation = v.spendChannel.refValidator![
      mode === "timeout"
        ? "timeout_packet"
        : mode === "error-ack"
        ? "acknowledge_packet"
        : "recv_packet"
    ];
    const channelRedeemer = mode === "timeout"
      ? variant(3, packet, proof.proof, height, 1n)
      : mode === "error-ack"
      ? variant(4, packet, errorAck, proof.proof, height)
      : variant(2, packet, proof.proof, height);
    const callback = mode === "timeout"
      ? variant(7, localChannel, payload, record(transferData))
      : variant(
        mode === "error-ack" ? 8 : 6,
        localChannel,
        payload,
        record(
          variant(
            mode === "error-ack" ? 1 : 0,
            fromText(mode === "error-ack" ? "rejected" : "AQ=="),
          ),
        ),
        record(transferData),
      );
    const processed =
      [...(client.state.fields[2] as Map<Data, Data>).values()][0];
    const processedHeight =
      [...(client.state.fields[3] as Map<Data, Data>).values()][0];
    const verifyFields = [
      client.client,
      client.consensus,
      height,
      processed,
      processedHeight,
      0n,
      0n,
      proof.proof,
      record([fromText("ibc"), remoteKey]),
    ];
    const tx = lucid.newTx().readFrom([
      root,
      clientUtxo,
      connectionUtxo,
      v.hostStateStt.refUtxo,
      v.spendChannel.refUtxo,
      operation.refUtxo,
      v.verifyProof.refUtxo,
      v.spendTransferModule.refUtxo,
    ])
      .collectFrom(
        [host],
        Data.to({ HandlePacket: witnesses }, HostStateRedeemer),
      )
      .collectFrom([channel], encode(channelRedeemer))
      .collectFrom([shard], encode(record(callback)))
      .mintAssets({ [operation.scriptHash]: 1n }, encode(channelToken))
      .mintAssets(
        { [v.verifyProof.scriptHash]: 1n },
        encode(
          record(
            mode === "timeout"
              ? variant(1, ...verifyFields)
              : record(...verifyFields, proofValue),
            variant(1),
          ),
        ),
      )
      .pay.ToContract(host.address, {
        kind: "inline",
        value: Data.to(
          {
            ...currentHost,
            state: {
              ...currentHost.state,
              version: currentHost.state.version + 1n,
              last_update_time: BigInt(emulator.now()),
              ibc_state_root: await tree.getRoot(),
            },
          },
          HostStateDatum,
          { canonical: true },
        ),
      }, host.assets)
      .pay.ToContract(channel.address, {
        kind: "inline",
        value: encode(nextChannel),
      }, channel.assets)
      .pay.ToContract(shard.address, {
        kind: "inline",
        value: encode(record(localChannel, denom, 0n)),
      }, { ...shard.assets, lovelace: shard.assets.lovelace - amount })
      .pay.ToAddress(recipient, { lovelace: amount })
      .validFrom(emulator.now()).validTo(emulator.now() + 60_000);
    await f.submit(tx, `shutdown ${mode}`);
    assertEquals(
      (await lucid.utxosAt(recipient)).reduce(
        (sum, u) => sum + u.assets.lovelace,
        0n,
      ),
      amount,
      "Exact user refund, independently of deployer fees",
    );
    assertEquals(escrowDatum(await lucid.utxoByUnit(shardUnit)).amount, 0n);
    const settledChannel = Data.from(
      (await lucid.utxoByUnit(unit(channelToken))).datum!,
    ) as Constr<Data>;
    assertEquals(
      ((settledChannel.fields[0] as Constr<Data>).fields[4] as Map<Data, Data>)
        .size,
      0,
    );
    assertStateDrained(
      await scanDeploymentState(lucid, deployment),
      deployment,
    );
    await f.waitForGrace();
    const transfer = (await scanDeploymentState(lucid, deployment)).find((g) =>
      g.kind === "transfer"
    )!;
    await f.submit(
      await buildReclaimEscrowTx(
        lucid,
        deployment,
        await f.host(),
        transfer,
        await lucid.utxoByUnit(shardUnit),
        f.address,
        emulator.now(),
      ),
      "reclaim drained escrow",
    );
    await f.finish(recipient);
  } finally {
    f.dispose();
  }
}
