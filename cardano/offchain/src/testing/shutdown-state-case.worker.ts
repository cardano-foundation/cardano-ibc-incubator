/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import { assert, assertEquals } from "@std/assert";
import { CML, Data, walletFromSeed } from "@lucid-evolution/lucid";
import {
  type ClientReclaimMutation,
  rejectClientReclaimMutation,
  shutdownFixture,
} from "./shutdown-fixture.ts";
import {
  buildReclaimEscrowTx,
  buildReclaimStateTx,
  scanDeploymentState,
} from "../shutdown.ts";

export interface ShutdownSnapshotCase {
  history: number;
  settledPackets: number;
  extraLovelace: bigint;
  vouchers: bigint;
  order: number[];
  legacy: boolean;
  mutation: ClientReclaimMutation;
}

async function checkCase(sample: ShutdownSnapshotCase) {
  const f = await shutdownFixture(
    0n,
    sample.legacy ? "legacy" : "staged",
    sample,
  );
  await rejectClientReclaimMutation(f, sample.mutation);
  // These arbitrary units test token conservation only. They do not establish
  // a valid transfer history or a redeemable claim on counterparty assets.
  const user = walletFromSeed(
    "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
    { network: "Custom" },
  ).address;
  assert(user !== f.account.address);
  const voucher = f.deployment.validators.mintVoucher.scriptHash + "0014df10" +
    "11".repeat(28);
  if (sample.vouchers) {
    f.seed(user, {
      lovelace: 5_000_000n,
      [voucher]: sample.vouchers,
    }, Data.void());
  }
  const stateAddresses = new Set([
    f.deployment.validators.spendClient.address,
    f.deployment.validators.spendConnection.address,
    f.deployment.validators.spendChannel.address,
    f.deployment.validators.spendTransferModule.address,
    f.deployment.validators.spendMockModule!.address,
    f.deployment.validators.spendTraceRegistry!.address,
    f.deployment.validators.voucherMetadata!.address,
  ]);
  // The oracle reads the ledger, not the scanner's claimed inventory.
  const live = () =>
    Object.values(f.emulator.ledger).filter(({ spent }) => !spent).map((
      { utxo },
    ) => utxo);
  const balance = () =>
    live().filter((u) => u.address === f.account.address).reduce(
      (sum, u) => sum + u.assets.lovelace,
      0n,
    );
  const before = balance();
  const deposits = live().filter((u) => stateAddresses.has(u.address)).reduce(
    (sum, u) => sum + u.assets.lovelace,
    0n,
  );
  let fees = 0n;
  const submit = f.emulator.submitTx.bind(f.emulator);
  f.emulator.submitTx = async (cbor) => {
    assert(cbor.length / 2 <= 16384, "Signed transaction exceeds ledger size");
    const tx = CML.Transaction.from_cbor_hex(cbor);
    const units = CML.compute_total_ex_units(tx.witness_set().redeemers()!);
    const limits = f.lucid.config().protocolParameters!;
    assert(
      units.mem() <= limits.maxTxExMem && units.steps() <= limits.maxTxExSteps,
      "Execution budget exceeded",
    );
    const hash = await submit(cbor);
    fees += tx.body().fee();
    return hash;
  };
  const transfer = (await scanDeploymentState(f.lucid, f.deployment)).find(
    (g) => g.kind === "transfer",
  )!;
  await f.submit(
    await buildReclaimEscrowTx(
      f.lucid,
      f.deployment,
      f.hostUtxo,
      transfer,
      f.shard,
      f.account.address,
      f.emulator.now(),
    ),
  );
  let step = 0;
  while (true) {
    const allGroups = await scanDeploymentState(f.lucid, f.deployment);
    let groups = allGroups.filter(
      (g) => g.utxos.length,
    );
    if (!groups.length) break;
    const dependenciesRemain = groups.some((g) =>
      g.kind === "channel" || g.kind === "client" || g.kind === "connection"
    );
    if (dependenciesRemain) {
      groups = groups.filter((g) => g.kind !== "transfer");
    }
    const group =
      groups[sample.order[step++ % sample.order.length] % groups.length];
    const transferRoot = allGroups.find((entry) => entry.kind === "transfer")
      ?.utxos.find((utxo) =>
        utxo.assets[f.deployment.modules.transfer.identifier] === 1n
      );
    await f.submit(
      buildReclaimStateTx(
        f.lucid,
        f.deployment,
        f.hostUtxo,
        { ...group, utxos: [group.utxos[0]] },
        f.account.address,
        f.emulator.now(),
        transferRoot,
      ),
    );
    f.lucid.overrideUTxOs([]);
  }
  assertEquals(live().filter((u) => stateAddresses.has(u.address)), []);
  assertEquals(
    balance(),
    before + deposits - fees,
    "All seeded state ADA returned, less actual fees",
  );
  assertEquals(
    live().filter((u) => u.address === user).reduce(
      (sum, u) => sum + (u.assets[voucher] ?? 0n),
      0n,
    ),
    sample.vouchers,
    "Seeded tokens remain owned by the separate user wallet",
  );
  assertEquals(
    live().filter((u) => u.address !== user).reduce(
      (sum, u) => sum + (u.assets[voucher] ?? 0n),
      0n,
    ),
    0n,
  );
}

self.onmessage = async ({ data }: MessageEvent<ShutdownSnapshotCase>) => {
  try {
    await checkCase(data);
    self.postMessage({});
  } catch (error) {
    self.postMessage({
      error: error instanceof Error
        ? error.stack ?? error.message
        : String(error),
    });
  }
};
