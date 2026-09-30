import type { DeploymentPlan } from "./deployment-plan.ts";
import {
  Constr,
  Data,
  fromText,
  type LucidEvolution,
  type MintingPolicy,
  type Script,
  type UTxO,
} from "@lucid-evolution/lucid";

/** Construct the reference outputs used by deployment, including their inline datum. */
export function buildReferenceBatchTx(
  lucid: LucidEvolution,
  referenceAddress: string,
  validators: Script[],
) {
  let tx = lucid.newTx();
  for (const validator of validators) {
    tx = tx.pay.ToContract(
      referenceAddress,
      { kind: "inline", value: Data.void() },
      { lovelace: 1_000_000n },
      validator,
    );
  }
  return tx;
}

/** Balance and sign separately from submission so preflight measures the real bytes. */
export async function completeReferenceBatchTx(
  lucid: LucidEvolution,
  referenceAddress: string,
  validators: Script[],
  dedicatedFunding?: UTxO,
) {
  const txBuilder = buildReferenceBatchTx(lucid, referenceAddress, validators);
  const [walletUTxOs, outputs, txSignBuilder] = await txBuilder.chain(
    dedicatedFunding
      ? {
        presetWalletInputs: [dedicatedFunding],
        includeLeftoverLovelaceAsFee: true,
      }
      : undefined,
  );
  const consumedWalletInputs = (txBuilder as unknown as {
    rawConfig: () => { consumedInputs?: UTxO[] };
  }).rawConfig().consumedInputs ?? [];
  const signedTx = await txSignBuilder.sign.withWallet().complete();
  return { walletUTxOs, outputs, signedTx, consumedWalletInputs };
}

export type HostStateBootstrap = {
  nonceUtxo: UTxO;
  mintingPolicy: MintingPolicy;
  hostStateNftUnit: string;
  hostStateAddress: string;
  encodedDatum: string;
  encodedRedeemer: string;
  packetPlan: Pick<
    DeploymentPlan,
    | "packetConfig"
    | "packetState"
    | "packetBatch"
    | "packetGuard"
    | "packetLaneCount"
    | "traceRegistry"
  >;
};

/** The initial HostState mint carries the NFT policy inline in its witnesses. */
export function buildHostStateBootstrapTx(
  lucid: LucidEvolution,
  bootstrap: HostStateBootstrap,
) {
  const plan = bootstrap.packetPlan;
  const record = (...fields: Data[]) => Data.to(new Constr(0, fields));
  return lucid.newTx()
    .attach.MintingPolicy(plan.packetConfig.script)
    .attach.MintingPolicy(plan.packetState.script)
    .mintAssets({
      [plan.packetConfig.hash + fromText("ibc_packet_config")]: 1n,
    }, Data.void())
    .mintAssets({
      [plan.packetState.hash + fromText("ibc_packet_registry")]: 1n,
    }, record())
    .pay.ToContract(plan.packetConfig.address, {
      kind: "inline",
      value: record(
        plan.packetState.hash,
        plan.packetBatch.hash,
        plan.packetGuard.hash,
        BigInt(plan.packetLaneCount),
        plan.traceRegistry.hash,
      ),
    }, { [plan.packetConfig.hash + fromText("ibc_packet_config")]: 1n })
    .pay.ToContract(plan.packetState.address, {
      kind: "inline",
      value: record(0n),
    }, { [plan.packetState.hash + fromText("ibc_packet_registry")]: 1n })
    .collectFrom([bootstrap.nonceUtxo])
    .attach.MintingPolicy(bootstrap.mintingPolicy)
    .mintAssets(
      { [bootstrap.hostStateNftUnit]: 1n },
      bootstrap.encodedRedeemer,
    )
    .pay.ToContract(
      bootstrap.hostStateAddress,
      { kind: "inline", value: bootstrap.encodedDatum },
      { [bootstrap.hostStateNftUnit]: 1n },
    );
}

/** Deployment's mock asset mint includes its policy witness and token change. */
export function buildMockTokenMintTx(
  lucid: LucidEvolution,
  mintingPolicy: MintingPolicy,
  tokenUnit: string,
  walletAddress: string,
) {
  return lucid.newTx()
    .attach.MintingPolicy(mintingPolicy)
    .mintAssets({ [tokenUnit]: 9_999_999_999n }, Data.void())
    .pay.ToAddress(walletAddress, { [tokenUnit]: 999_999_999n });
}
