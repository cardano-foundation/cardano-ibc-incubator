import { assertEquals, assertRejects } from "@std/assert";
import { Constr, Data, fromText, type UTxO } from "@lucid-evolution/lucid";
import {
  buildPacketAcknowledgement,
  buildPacketReceive,
  buildPacketRejection,
  buildPacketSendBatch,
  buildTransferIntent,
  encode,
  type PacketLaneDeployment,
  record,
  sha256,
  voucherTokenName,
} from "../packet-lane-transactions.ts";
import {
  buildReclaimStateTx,
  buildRetirePacketLanesTx,
  scanDeploymentState,
} from "../shutdown.ts";
import {
  clientStateWithHistory,
  deploymentScenario,
} from "./shutdown-model.ts";
import { membershipProof } from "./channel-fixture.ts";
import { assertLedgerSupply, ledgerBalances } from "./funds-oracle.ts";

type Fixture = Awaited<ReturnType<typeof deploymentScenario>>;
export async function checkVoucherDrain(
  f: Fixture,
  lane: PacketLaneDeployment,
  snapshot: (
    address: string,
    assets: Record<string, bigint>,
    datum: string,
  ) => UTxO,
  incoming: Constr<Data>,
  receiveProof: Constr<Data>,
  amount: bigint,
  userSeed: string,
  userAddress: string,
) {
  const { lucid, deployment, emulator } = f;
  const denom = "transfer/channel-0/uatom";
  const token = voucherTokenName(denom);
  const unit = lane.voucherPolicy! + token;
  const metadata = snapshot(
    deployment.validators.voucherMetadata!.address,
    {
      lovelace: 3_000_000n,
      [lane.voucherPolicy! + "000643b0" + token.slice(8)]: 1n,
    },
    encode(record(
      new Map([
        [fromText("name"), fromText("uatom")],
        [fromText("ticker"), fromText("uatom")],
        [fromText("description"), fromText(`IBC voucher for ${denom}`)],
      ]),
      1n,
      new Map<Data, Data>([
        [fromText("path"), fromText("transfer/channel-0")],
        [fromText("baseDenom"), fromText("uatom")],
        [fromText("fullDenom"), fromText(denom)],
        [fromText("ibcDenomHash"), fromText(await sha256(fromText(denom)))],
        [fromText("traceVersion"), 1n],
        [fromText("voucherPolicyId"), fromText(lane.voucherPolicy!)],
        [fromText("voucherTokenName"), fromText(token)],
      ]),
    )),
  );
  lane.scripts.push(metadata);
  const setHost = async () => {
    const hostUnit = deployment.hostStateNFT!.policyId +
      deployment.hostStateNFT!.name;
    lane.scripts = lane.scripts.filter((u) => u.assets[hostUnit] !== 1n);
    lane.scripts.push(await f.host());
  };
  const assertSupply = (expected: bigint) => {
    assertLedgerSupply(emulator, unit, expected);
    assertEquals(
      ledgerBalances(emulator, unit).get(userAddress) ?? 0n,
      expected,
    );
  };
  await f.submit(
    (await buildPacketReceive(
      lucid,
      lane,
      incoming,
      record(1n, 10n),
      receiveProof,
      [],
      emulator.now(),
      emulator.now() + 60_000,
    )).tx,
    "receive user voucher",
  );
  assertSupply(amount);
  await f.enter(1);
  await f.waitForGrace();
  await setHost();
  const rejectCleanup = async () => {
    const groups = await scanDeploymentState(lucid, deployment);
    for (
      const group of groups.filter((g) =>
        ["trace", "metadata"].includes(g.kind) && g.utxos.length
      )
    ) {
      await assertRejects(
        async () =>
          buildReclaimStateTx(
            lucid,
            deployment,
            await f.host(),
            group,
            f.address,
            emulator.now(),
            await lucid.utxoByUnit(deployment.modules.transfer.identifier),
          ).complete({ localUPLCEval: true }),
        Error,
        "failed script execution",
      );
    }
    await assertRejects(
      async () =>
        buildRetirePacketLanesTx(
          lucid,
          deployment,
          await f.host(),
          lane.channel,
          f.address,
          emulator.now(),
        ),
      Error,
    );
  };
  await rejectCleanup();
  const send = async () => {
    lucid.selectWallet.fromSeed(userSeed, { addressType: "Enterprise" });
    lucid.clearUTxOOverride();
    await f.submit(
      await buildTransferIntent(lucid, lane, {
        amount,
        assetUnit: unit,
        fullDenom: denom,
        reserve: 3_000_000n,
        receiver: "cosmos1receiver",
        timeoutTimestamp: BigInt(emulator.now() + 86_400_000) * 1_000_000n,
      }),
      "fund voucher return",
    );
    const intents = (await lucid.utxosAt(lane.guardAddress)).filter((u) =>
      (Data.from(u.datum!) as Constr<Data>).fields.length === 5
    );
    lucid.selectWallet.fromSeed(f.seedPhrase);
    lucid.clearUTxOOverride();
    const batch = await buildPacketSendBatch(
      lucid,
      lane,
      intents,
      emulator.now(),
      emulator.now() + 60_000,
    );
    await f.submit(batch.tx, "return vouchers during shutdown");
    assertSupply(0n);
    return batch.packets[0];
  };
  let height = 20;
  const settle = async (packet: Constr<Data>, success: boolean) => {
    const ack = fromText(
      success ? '{"result":"AQ=="}' : '{"error":"rejected"}',
    );
    const proof = await membershipProof(
      fromText(
        `acks/ports/transfer/channels/channel-7/sequences/${packet.fields[0]}`,
      ),
      await sha256(ack),
    );
    const state = clientStateWithHistory(
      [height],
      emulator.now() - 60_000,
      proof.root,
    );
    const clientDatum = Data.from(lane.client.datum!) as Constr<Data>;
    clientDatum.fields[0] = state.state;
    lane.client.datum = encode(clientDatum);
    const at = record(1n, BigInt(height++));
    const completed = success
      ? await buildPacketAcknowledgement(
        lucid,
        lane,
        packet,
        at,
        proof.proof,
        emulator.now(),
        emulator.now() + 60_000,
      )
      : await buildPacketRejection(
        lucid,
        lane,
        packet,
        at,
        proof.proof,
        [],
        "rejected",
        emulator.now(),
        emulator.now() + 60_000,
      );
    await f.submit(
      completed.tx,
      success ? "acknowledge voucher return" : "refund rejected voucher return",
    );
  };
  const first = await send();
  await rejectCleanup();
  await settle(first, false);
  assertSupply(amount);
  await rejectCleanup();
  const retry = await send();
  await settle(retry, true);
  assertSupply(0n);
  await f.finish(userAddress);
}
