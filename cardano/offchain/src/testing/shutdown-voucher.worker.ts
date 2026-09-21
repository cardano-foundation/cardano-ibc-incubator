/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import { assertEquals, assertRejects } from "@std/assert";
import {
  Constr,
  Data,
  fromText,
  getAddressDetails,
} from "@lucid-evolution/lucid";
import { HostStateDatum } from "../../types/index.ts";
import { DeploymentIbcTree } from "../deployment.ts";
import { buildReclaimStateTx } from "../shutdown.ts";
import type { DeploymentTemplate } from "../utils.ts";
import {
  firstPacket,
  knownVoucher,
  nextSend,
  receiveNative,
  settle,
} from "./funds-lifecycle.ts";
import {
  defaultSendParameters,
  sendPacketFixture,
} from "./send-budget-fixture.ts";

const userSeed =
  "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";

async function checkVoucherShutdown(amount: bigint) {
  const f = await sendPacketFixture({
    ...defaultSendParameters,
    amount: 2_000_000n,
    sequence: 1n,
  });
  const deployerSeed = f.account.seedPhrase;
  const deployerAddress = f.account.address;
  const deployer = getAddressDetails(deployerAddress).paymentCredential!.hash;
  const submit = async (
    tx: ReturnType<typeof f.lucid.newTx>,
    label: string,
  ) => {
    try {
      const completed = await tx.complete({ localUPLCEval: true });
      await (await completed.sign.withWallet().complete()).submit();
      f.emulator.awaitBlock();
    } catch (cause) {
      throw new Error(
        `${label} failed: ${
          cause instanceof Error ? cause.stack : String(cause)
        }`,
        { cause },
      );
    }
  };
  const ledgerBalance = (address: string, unit: string) =>
    Object.values(f.emulator.ledger).filter(({ spent, utxo }) =>
      !spent && utxo.address === address
    ).reduce((sum, { utxo }) => sum + (utxo.assets[unit] ?? 0n), 0n);
  const ledgerSupply = (unit: string) =>
    Object.values(f.emulator.ledger).filter(({ spent }) => !spent).reduce(
      (sum, { utxo }) => sum + (utxo.assets[unit] ?? 0n),
      0n,
    );

  try {
    await submit(f.tx, "setup send");
    await submit((await settle(f, firstPacket(f), "error")).tx, "setup refund");
    await submit(
      f.lucid.newTx().register.Stake(f.shutdownScript.address),
      "register recovery stake",
    );

    const voucher = await knownVoucher(f, "uatom", userSeed);
    assertEquals(voucher.owner === deployer, false);
    await submit(
      (await receiveNative(f, amount, 1n, "none", voucher)).tx,
      "voucher receive",
    );
    assertEquals(ledgerBalance(voucher.address, voucher.unit), amount);
    assertEquals(ledgerSupply(voucher.unit), amount);

    // The native setup packet has already been refunded. Clear its empty shard
    // registration in this explicitly assumed snapshot so the voucher
    // obligation is the only root-state reason reclamation can fail.
    const root = await f.lucid.utxoByUnit(
      f.packetContext.moduleToken.policy_id + f.packetContext.moduleToken.name,
    );
    root.datum = Data.to(
      new Constr(0, [
        await new DeploymentIbcTree().getRoot(),
        amount,
      ]),
    );
    const host = await f.lucid.utxoByUnit(
      f.packetContext.hostPolicy + fromText("ibc_host_state"),
    );
    const hostDatum = Data.from(host.datum!, HostStateDatum);
    host.datum = Data.to(
      {
        ...hostDatum,
        deployer,
        control: {
          ...hostDatum.control,
          shutdown: {
            ShuttingDown: {
              initiated_at: BigInt(f.emulator.now() - 86_400_000),
              grace_period_end: BigInt(f.emulator.now()),
            },
          },
        },
      },
      HostStateDatum,
      { canonical: true },
    );

    const deployment = {
      validators: {
        spendChannel: {
          title: "spending_channel.spend_channel.spend",
          script: f.channelScripts.base.script.script,
          scriptHash: f.channelScripts.base.hash,
          address: f.channelScripts.base.address,
          refUtxo: f.reference(f.channelScripts.base.script),
        },
        mintChannelStt: f.channelMint,
        mintClientStt: { scriptHash: "" },
        mintConnectionStt: { scriptHash: "" },
        mintIdentifier: { scriptHash: "" },
        spendClient: {
          title: "spending_multitx_client.spend_multitx_client.spend",
        },
        recoverClient: f.shutdownScript,
        spendTransferModule: {
          script: f.funds.moduleScript.script,
          scriptHash: f.funds.moduleHash,
          address: f.funds.moduleAddress,
          refUtxo: f.reference(f.funds.moduleScript),
        },
        mintTransferEscrowShard: {
          scriptHash: f.funds.escrowPolicy,
        },
        mintVoucher: { scriptHash: f.funds.voucherPolicy },
      },
      modules: {
        transfer: {
          identifier: f.packetContext.moduleToken.policy_id +
            f.packetContext.moduleToken.name,
          address: f.funds.moduleAddress,
        },
      },
    } as unknown as DeploymentTemplate;
    const channelGroup = async () => ({
      kind: "channel" as const,
      validator: deployment.validators.spendChannel,
      utxos: [
        await f.lucid.utxoByUnit(
          String(f.channelToken.fields[0]) + String(f.channelToken.fields[1]),
        ),
      ],
    });

    f.lucid.selectWallet.fromSeed(deployerSeed);
    await assertRejects(
      async () =>
        await buildReclaimStateTx(
          f.lucid,
          deployment,
          host,
          await channelGroup(),
          deployerAddress,
          f.emulator.now(),
          root,
        ).complete({ localUPLCEval: true }),
      Error,
      "failed script execution",
    );

    f.lucid.selectWallet.fromSeed(userSeed, { addressType: "Enterprise" });
    const returned = await nextSend(f, amount, "none", voucher);
    await submit(returned.tx, "voucher return");
    assertEquals(ledgerBalance(voucher.address, voucher.unit), 0n);
    assertEquals(ledgerSupply(voucher.unit), 0n);
    assertEquals(
      (Data.from(
        (await f.lucid.utxoByUnit(
          f.packetContext.moduleToken.policy_id +
            f.packetContext.moduleToken.name,
        )).datum!,
      ) as Constr<Data>).fields[1],
      amount,
    );

    // A successful acknowledgement resolves the counterparty claim and burns
    // the retained obligation. Until this packet settles the channel datum
    // also records the pending return.
    await submit(
      (await settle(f, returned.sent, "ack", "none", voucher)).tx,
      "voucher acknowledgement",
    );
    const settledRoot = await f.lucid.utxoByUnit(
      f.packetContext.moduleToken.policy_id + f.packetContext.moduleToken.name,
    );
    assertEquals((Data.from(settledRoot.datum!) as Constr<Data>).fields[1], 0n);

    f.lucid.selectWallet.fromSeed(deployerSeed);
    await buildReclaimStateTx(
      f.lucid,
      deployment,
      await f.lucid.utxoByUnit(
        f.packetContext.hostPolicy + fromText("ibc_host_state"),
      ),
      await channelGroup(),
      deployerAddress,
      f.emulator.now(),
      settledRoot,
    ).complete({ localUPLCEval: true });
  } finally {
    /* worker owns only emulator state */
  }
}

self.onmessage = async ({ data }: MessageEvent<{ amount: bigint }>) => {
  try {
    await checkVoucherShutdown(data.amount);
    self.postMessage({});
  } catch (error) {
    self.postMessage({
      error: error instanceof Error
        ? error.stack ?? error.message
        : String(error),
    });
  }
};
