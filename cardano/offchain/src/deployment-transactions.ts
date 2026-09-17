import {
  Data,
  type LucidEvolution,
  type MintingPolicy,
  type Script,
  type UTxO,
} from "@lucid-evolution/lucid";
import { Registry } from "../types/plutus/Migration.ts";

export function buildRegistryBootstrapTx(lucid: LucidEvolution, input: {
  nonce: UTxO;
  policy: Script;
  address: string;
  registry: Registry;
  signers: string[];
}) {
  const unit = input.registry.token.policy_id + input.registry.token.name;
  let tx = lucid.newTx().collectFrom([input.nonce])
    .attach.MintingPolicy(input.policy).mintAssets({ [unit]: 1n }, Data.void())
    .pay.ToContract(input.address, {
      kind: "inline",
      value: Data.to(input.registry, Registry),
    }, { [unit]: 1n });
  for (const signer of new Set(input.signers)) tx = tx.addSignerKey(signer);
  return tx;
}

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
  validTo?: number,
) {
  const txBuilder = buildReferenceBatchTx(lucid, referenceAddress, validators);
  if (validTo !== undefined) txBuilder.validTo(validTo);
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
};

/** The initial HostState mint carries the NFT policy inline in its witnesses. */
export function buildHostStateBootstrapTx(
  lucid: LucidEvolution,
  bootstrap: HostStateBootstrap,
) {
  return lucid.newTx()
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
