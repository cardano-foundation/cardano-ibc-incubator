import { Data, fromText, Kupmios, type UTxO } from "@lucid-evolution/lucid";
import {
  escrowDenomTokenFromPacketDenom,
  transferEscrowShardTokenName,
} from "../../../packages/cardano-ibc-tx-builder-runtime/src/transferEscrowIdentity.ts";

const EscrowDatumSchema = Data.Object({
  channel_id: Data.Bytes(),
  denom: Data.Bytes(),
  escrowed_amount: Data.Integer(),
});
type EscrowDatum = Data.Static<typeof EscrowDatumSchema>;
const EscrowDatum = EscrowDatumSchema as unknown as EscrowDatum;

export type EscrowSnapshot = {
  output: string;
  address: string;
  shardToken: string;
  asset: string;
  datum: string;
  channel: string;
  denom: string;
  escrowedAmount: string;
  assets: Record<string, string>;
};

// The deployed shard scheme permits exactly one holder for a channel/denom.
// Read the address independently of Gateway's transaction-building lookup.
export function escrowSnapshot(
  utxos: UTxO[],
  address: string,
  policy: string,
  channel: string,
  denom: string,
): EscrowSnapshot {
  if (!/^[0-9a-f]{56}$/.test(policy) || !/^channel-[0-9]+$/.test(channel)) {
    throw new Error("Invalid escrow policy or channel");
  }
  const channelHex = fromText(channel);
  // ICS-20 carries ADA as the hex spelling of "lovelace" inside the datum's bytes.
  const denomHex = fromText(denom === "lovelace" ? fromText(denom) : denom);
  const asset = escrowDenomTokenFromPacketDenom(denomHex);
  const shardToken = policy +
    transferEscrowShardTokenName(channelHex, denomHex);
  const holders = utxos.filter((utxo) => shardToken in utxo.assets);
  if (holders.length !== 1) {
    throw new Error(
      `Expected exactly one escrow shard, found ${holders.length}`,
    );
  }
  const utxo = holders[0];
  if (
    utxo.address !== address || utxo.assets[shardToken] !== 1n || !utxo.datum ||
    !/^[0-9a-f]{64}$/.test(utxo.txHash) ||
    !Number.isSafeInteger(utxo.outputIndex) || utxo.outputIndex < 0
  ) {
    throw new Error("Invalid escrow shard holder");
  }
  const datum = Data.from(utxo.datum, EscrowDatum);
  if (
    datum.channel_id !== channelHex || datum.denom !== denomHex ||
    datum.escrowed_amount < 0n ||
    (utxo.assets[asset] ?? 0n) < datum.escrowed_amount ||
    Data.to(datum, EscrowDatum, { canonical: true }) !== utxo.datum
  ) {
    throw new Error("Escrow datum does not match its route, asset or funds");
  }
  const assets: Record<string, string> = {};
  for (const unit of Object.keys(utxo.assets).sort()) {
    const amount = utxo.assets[unit];
    if (
      (unit !== asset && unit !== "lovelace" && unit !== shardToken) ||
      amount < 0n
    ) {
      throw new Error("Escrow shard contains unexpected assets or balances");
    }
    assets[unit] = amount.toString();
  }
  return {
    output: `${utxo.txHash}#${utxo.outputIndex}`,
    address,
    shardToken,
    asset,
    datum: utxo.datum,
    channel,
    denom,
    escrowedAmount: datum.escrowed_amount.toString(),
    assets,
  };
}

export function assertEscrowIncrease(
  before: EscrowSnapshot,
  after: EscrowSnapshot,
  amount: bigint,
): void {
  if (
    amount <= 0n || before.output === after.output ||
    before.address !== after.address ||
    before.shardToken !== after.shardToken ||
    before.asset !== after.asset || before.channel !== after.channel ||
    before.denom !== after.denom ||
    BigInt(after.escrowedAmount) - BigInt(before.escrowedAmount) !== amount
  ) {
    throw new Error(
      "Transfer did not preserve the escrow shard and increase its deposit exactly",
    );
  }
  const units = new Set([
    ...Object.keys(before.assets),
    ...Object.keys(after.assets),
  ]);
  for (const unit of units) {
    const delta = BigInt(after.assets[unit] ?? "0") -
      BigInt(before.assets[unit] ?? "0");
    // The focused fixture uses a native token. Lovelace stays in the existing
    // shard as its minimum-ADA reserve, it is not a source of transaction fees.
    if (delta !== (unit === before.asset ? amount : 0n)) {
      throw new Error(`Unexpected escrow asset delta for ${unit}`);
    }
  }
}

async function main(args: string[]) {
  const [command, ...values] = args;
  if (command === "assert-increase" && values.length === 3) {
    assertEscrowIncrease(
      JSON.parse(values[0]),
      JSON.parse(values[1]),
      BigInt(values[2]),
    );
    return;
  }
  if (command !== "snapshot" || values.length !== 3) {
    throw new Error(
      "Usage: recovery-escrow.ts snapshot <handler.json> <channel> <denom> | assert-increase <before-json> <after-json> <amount>",
    );
  }
  const [handlerFile, channel, denom] = values;
  const handler = JSON.parse(await Deno.readTextFile(handlerFile));
  const address = handler.modules?.transfer?.address;
  const policy = handler.validators?.mintTransferEscrowShard?.scriptHash;
  if (typeof address !== "string" || !address || typeof policy !== "string") {
    throw new Error(
      "Deployment is missing the transfer address or escrow shard policy",
    );
  }
  const provider = new Kupmios(
    Deno.env.get("KUPO_URL") ?? "http://localhost:1442",
    Deno.env.get("OGMIOS_URL") ?? "http://localhost:1337",
  );
  const snapshot = escrowSnapshot(
    await provider.getUtxos(address),
    address,
    policy,
    channel,
    denom,
  );
  console.log(JSON.stringify(snapshot));
}

if (import.meta.main) {
  await main(Deno.args);
}
