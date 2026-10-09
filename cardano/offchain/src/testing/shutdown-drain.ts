import {
  buildPacketLaneInitialization,
  buildPacketReceive,
  buildPacketRejection,
  buildPacketSendBatch,
  buildPacketTimeout,
  buildTransferIntentCancellation,
  type PacketLaneDeployment,
} from "../packet-lane-transactions.ts";
import {
  liquidityTokenName,
  packetLaneTokenName,
  sendSequencerTokenName,
} from "@cardano-ibc/tx-builder/dist/packet-lanes";
import {
  buildRetirePacketLanesTx,
  packetShutdownReferences,
} from "../shutdown.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
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
import {
  HostStateDatum,
  ModuleRegistrationSchema,
} from "../../types/plutus/index.ts";
import { DeploymentIbcTree } from "../deployment.ts";
import { generateTokenName } from "../utils.ts";
import { buildReclaimStateTx, scanDeploymentState } from "../shutdown.ts";
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
export type DrainMode = "timeout" | "error-ack" | "return" | "voucher";
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
  const voucherUserSeed =
    "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
  const voucherUserAddress = walletFromSeed(voucherUserSeed, {
    network: "Custom",
    addressType: "Enterprise",
  }).address;
  const recipientKey =
    getAddressDetails(mode === "voucher" ? voucherUserAddress : f.address)
      .paymentCredential!.hash;
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
      denom: mode === "voucher"
        ? "uatom"
        : mode === "return"
        ? `transfer/channel-7/${fromText("lovelace")}`
        : fromText("lovelace"),
      memo: "shutdown drain",
      receiver: (mode === "return" || mode === "voucher")
        ? recipientKey
        : "cosmos1receiver",
      sender: (mode === "return" || mode === "voucher")
        ? "cosmos1sender"
        : recipientKey,
    };
    const payload = fromText(JSON.stringify(payloadFields));
    const timeout =
      BigInt(emulator.now() + (mode === "timeout" ? -1_000 : 7 * 86_400_000)) *
      1_000_000n;
    const timeoutHeight = record(0n, 0n);
    const packet = record(
      1n,
      port,
      fromText(
        (mode === "return" || mode === "voucher") ? "channel-7" : "channel-0",
      ),
      port,
      fromText(
        (mode === "return" || mode === "voucher") ? "channel-0" : "channel-7",
      ),
      payload,
      timeoutHeight,
      timeout,
    );
    const commitment = await packetCommitment(packet);
    const errorAck = fromText('{"error":"rejected"}');
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
      1n,
      1n,
      1n,
      new Map(),
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
      "clients/07-tendermint-0/consensusStates/1-10",
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
    const snapshotAda = (mode === "voucher" ? 41_000_000n : 21_000_000n) +
      2n * amount;
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
    const channelUtxo = snapshot(v.spendChannel.address, {
      lovelace: 5_000_000n,
      [unit(channelToken)]: 1n,
    }, encode(channelDatum));
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
        control: {
          ...hostDatum.control,
          live_clients: 1n,
          live_connections: 1n,
          live_channels: 1n,
        },
      },
      HostStateDatum,
      { canonical: true },
    );
    lucid.overrideUTxOs(await emulator.getUtxos(f.address));
    emulator.awaitSlot(61);

    const p = deployment.packetState;
    const configuration = await lucid.utxoByUnit(
      p.configToken.policyId + p.configToken.name,
    );
    const laneDeployment: PacketLaneDeployment = {
      batchPolicy: p.batch.scriptHash,
      batchAddress: p.batch.address,
      guardAddress: p.guard.address,
      statePolicy: p.state.scriptHash,
      laneCount: p.laneCount,
      voucherPolicy: v.mintVoucher.scriptHash,
      operations: Object.fromEntries(
        Object.entries(p.operations).map((
          [name, script],
        ) => [name, { policy: script.scriptHash, reference: script.refUtxo }]),
      ),
      proofVerifier: {
        policy: v.verifyProof.scriptHash,
        reference: v.verifyProof.refUtxo,
      },
      channel: channelUtxo,
      connection: connectionUtxo,
      client: clientUtxo,
      scripts: [
        p.batch.refUtxo,
        p.guard.refUtxo,
        p.state.refUtxo,
        v.mintVoucher.refUtxo,
      ],
    };
    await f.submit(
      await buildPacketLaneInitialization(
        lucid,
        laneDeployment,
        configuration,
        p.state.address,
      ),
      "initialize packet lanes",
    );
    laneDeployment.scripts.push(configuration, await f.host());
    if (mode === "voucher") {
      const { checkVoucherDrain } = await import("./shutdown-voucher-drain.ts");
      snapshot(
        voucherUserAddress,
        { lovelace: 23_000_000n + 2n * amount },
        Data.void(),
      );
      await checkVoucherDrain(
        f,
        laneDeployment,
        snapshot,
        packet,
        proof.proof,
        amount,
        voucherUserSeed,
        voucherUserAddress,
      );
      return;
    }
    // Complete the single assumed pre-shutdown history. Principal and reserves
    // are deducted from the genesis wallet above. All subsequent changes submit.
    const laneUnit = p.state.scriptHash +
      packetLaneTokenName("transfer", "channel-0", 1, p.laneCount);
    const lane = await lucid.utxoByUnit(laneUnit);
    const laneDatum = Data.from(lane.datum!) as Constr<Data>;
    if (mode !== "return") {
      (laneDatum.fields[6] as Map<Data, Data>).set(1n, commitment);
      const root = new DeploymentIbcTree();
      root.set(`commitments/${localPath}/sequences/1`, commitment);
      laneDatum.fields[5] = await root.getRoot();
    }
    laneDatum.fields[11] = new Map([[
      await sha256(fromText(fromText("lovelace"))),
      amount,
    ]]);
    lane.datum = encode(laneDatum);
    const sequencer = await lucid.utxoByUnit(
      p.state.scriptHash + sendSequencerTokenName("transfer", "channel-0"),
    );
    const sequencerDatum = Data.from(sequencer.datum!) as Constr<Data>;
    sequencerDatum.fields[3] = 2n;
    sequencer.datum = encode(sequencerDatum);
    const deposit = record("ab".repeat(32), 0n);
    const liquidityName = liquidityTokenName(
      "transfer",
      "channel-0",
      fromText("lovelace"),
      String(deposit.fields[0]),
      0,
    );
    const liquidity = snapshot(
      p.batch.address,
      {
        lovelace: amount + 3_000_000n,
        [p.batch.scriptHash + liquidityName]: 1n,
      },
      encode(
        record(
          port,
          localChannel,
          denom,
          "",
          "",
          deposit,
          amount,
          Data.from(credentialAddressData(recipientKey)),
        ),
      ),
    );
    const intent = snapshot(
      p.guard.address,
      { lovelace: amount + 3_000_000n },
      encode(
        record(
          port,
          localChannel,
          recipientKey,
          record(
            fromText(fromText("lovelace")),
            fromText(amount.toString()),
            fromText(recipientKey),
            fromText("cosmos1receiver"),
            fromText("shutdown"),
          ),
          BigInt(emulator.now() + 7 * 86_400_000) * 1_000_000n,
        ),
      ),
    );
    const newDeposit = () =>
      buildPacketSendBatch(
        lucid,
        laneDeployment,
        [intent],
        emulator.now(),
        emulator.now() + 60_000,
      );
    await (await newDeposit()).tx.complete({ localUPLCEval: true });
    await f.enter(graceDays);
    laneDeployment.scripts[laneDeployment.scripts.length - 1] = await f.host();
    await assertRejects(
      async () =>
        (await newDeposit()).tx.complete({ localUPLCEval: true }),
      Error,
      "failed script execution",
    );
    await f.submit(
      await buildTransferIntentCancellation(lucid, laneDeployment, intent),
      "cancel unbatched intent",
    );
    await f.rejectPrematureCleanup();
    if (settleNearDeadline) {
      await f.rejectPrematureCleanup(1);
    }
    if (settleAfterGrace) await f.waitForGrace();
    if (settleAfterGrace) {
      await assertRejects(async () =>
        buildRetirePacketLanesTx(
          lucid,
          deployment,
          await f.host(),
          channelUtxo,
          f.address,
          emulator.now(),
        ), Error);
      const groups = await scanDeploymentState(lucid, deployment);
      for (const kind of ["client", "connection", "channel"] as const) {
        await assertRejects(
          async () =>
            buildReclaimStateTx(
              lucid,
              deployment,
              await f.host(),
              groups.find((g) => g.kind === kind)!,
              f.address,
              emulator.now(),
              await lucid.utxoByUnit(deployment.modules.transfer.identifier),
              await packetShutdownReferences(
                lucid,
                deployment,
                groups.find((g) => g.kind === kind)!,
              ),
            ).complete({ localUPLCEval: true }),
          Error,
          "failed script execution",
        );
      }
    }
    laneDeployment.scripts[laneDeployment.scripts.length - 1] = await f.host();
    const now = emulator.now();
    const settlement = mode === "timeout"
      ? await buildPacketTimeout(
        lucid,
        laneDeployment,
        packet,
        height,
        proof.proof,
        [liquidity],
        now,
        now + 60_000,
      )
      : mode === "error-ack"
      ? await buildPacketRejection(
        lucid,
        laneDeployment,
        packet,
        height,
        proof.proof,
        [liquidity],
        "rejected",
        now,
        now + 60_000,
      )
      : await buildPacketReceive(
        lucid,
        laneDeployment,
        packet,
        height,
        proof.proof,
        [liquidity],
        now,
        now + 60_000,
      );
    await f.submit(settlement.tx, `shutdown ${mode}`);
    assertEquals(
      (await lucid.utxosAt(p.batch.address)).length,
      0,
      "Full drain burns the liquidity identity and refunds its reserve",
    );
    const settled = Data.from(
      (await lucid.utxoByUnit(laneUnit)).datum!,
    ) as Constr<Data>;
    assertEquals((settled.fields[6] as Map<Data, Data>).size, 0);
    assertEquals((settled.fields[11] as Map<Data, Data>).size, 0);
    await f.waitForGrace();
    if (settleAfterGrace) {
      const host = await f.host();
      const build = () =>
        buildRetirePacketLanesTx(
          lucid,
          deployment,
          host,
          channelUtxo,
          f.address,
          emulator.now(),
        );
      await (await build())!.complete({ localUPLCEval: true });
      const original = lucid.newTx.bind(lucid);
      lucid.newTx = () => {
        const tx = original();
        const pay = tx.pay.ToContract.bind(tx.pay);
        tx.pay.ToContract = ((address, datum, assets, ...rest) => {
          if (address === p.state.address) {
            // A first retirement cannot claim that every lane has been burned.
            datum = {
              kind: "inline",
              value: encode(record(BigInt(p.laneCount))),
            };
          }
          return pay(address, datum, assets, ...rest);
        }) as typeof tx.pay.ToContract;
        return tx;
      };
      try {
        await assertRejects(
          async () => (await build())!.complete({ localUPLCEval: true }),
          Error,
          "failed script execution",
        );
      } finally {
        lucid.newTx = original;
      }
    }
    await f.finish(recipient);
  } finally {
    f.dispose();
  }
}

function credentialAddressData(owner: string) {
  return encode(record(variant(0, owner), variant(1)));
}
