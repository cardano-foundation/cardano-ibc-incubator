import {
  Data,
  type LucidEvolution,
  type MintingPolicy,
  type Script,
  type UTxO,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { Registry } from "../types/plutus/Migration.ts";

/** Persist observed publications only after matching the exact signed outputs. */
export function verifyReferencePublications(
  txHash: string,
  address: string,
  validators: Script[],
  derived: UTxO[],
  observed: UTxO[],
): UTxO[] {
  return validators.map((validator) => {
    const hash = validatorToScriptHash(validator);
    const matches = (outputs: UTxO[]) =>
      outputs.filter((utxo) =>
        utxo.scriptRef && validatorToScriptHash(utxo.scriptRef) === hash
      );
    const expected = matches(derived);
    const published = matches(observed);
    if (expected.length !== 1 || published.length !== 1) {
      throw new Error(
        `Reference ${hash} has no unique signed and observed output`,
      );
    }
    const [a] = expected, [b] = published;
    if (
      a.txHash !== txHash || b.txHash !== txHash ||
      a.outputIndex !== b.outputIndex || a.address !== address ||
      b.address !== address || (a.datum ?? null) !== (b.datum ?? null) ||
      Object.keys(a.assets).length !== Object.keys(b.assets).length ||
      Object.entries(a.assets).some(([unit, amount]) =>
        b.assets[unit] !== amount
      )
    ) {
      throw new Error(`Reference ${hash} differs from its signed publication`);
    }
    return b;
  });
}

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

/**
 * A wallet output reserved for one reference batch. Leftover lovelace is burned
 * as fee only for near-limit batches that have no room for a change output.
 */
export type ReferenceBatchFunding = { utxo: UTxO; leftoverAsFee: boolean };

/** Balance and sign separately from submission so preflight measures the real bytes. */
export async function completeReferenceBatchTx(
  lucid: LucidEvolution,
  referenceAddress: string,
  validators: Script[],
  funding?: ReferenceBatchFunding,
  validTo?: number,
) {
  const txBuilder = buildReferenceBatchTx(lucid, referenceAddress, validators);
  if (validTo !== undefined) txBuilder.validTo(validTo);
  if (funding?.leftoverAsFee) {
    // Set the reserved fee before balancing so Lucid does not construct a
    // temporary change output that can push a near-limit batch over maxTxSize.
    const { totalOutputAssets } = await txBuilder.config();
    txBuilder.setMinFee(
      funding.utxo.assets.lovelace - totalOutputAssets.lovelace,
    );
  }
  const availableWalletInputs = funding
    ? [funding.utxo]
    : await lucid.wallet().getUtxos();
  const [walletUTxOs, outputs, txSignBuilder] = await txBuilder.chain(
    funding
      ? {
        presetWalletInputs: [funding.utxo],
        includeLeftoverLovelaceAsFee: funding.leftoverAsFee,
      }
      : undefined,
  );
  const signedTx = await txSignBuilder.sign.withWallet().complete();
  const inputs = signedTx.toTransaction().body().inputs();
  const consumedReferences = new Set<string>();
  for (let index = 0; index < inputs.len(); index += 1) {
    const input = inputs.get(index);
    consumedReferences.add(
      `${input.transaction_id().to_hex()}#${Number(input.index())}`,
    );
  }
  const consumedWalletInputs = availableWalletInputs.filter((utxo) =>
    consumedReferences.has(`${utxo.txHash}#${utxo.outputIndex}`)
  );
  return { walletUTxOs, outputs, signedTx, consumedWalletInputs };
}

/** One wallet output per reference batch, in batch order, before any change. */
export function buildReferenceFundingTx(
  lucid: LucidEvolution,
  walletAddress: string,
  fundingLovelace: bigint[],
) {
  let tx = lucid.newTx();
  for (const lovelace of fundingLovelace) {
    tx = tx.pay.ToAddress(walletAddress, { lovelace });
  }
  return tx;
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

export type IdentifierThreadMint = {
  nonceUtxo: UTxO;
  mintingPolicy: MintingPolicy;
  tokenUnit: string;
  encodedRedeemer: string;
  address: string;
  encodedDatum: string;
};

/** Trace-registry shards and the directory each mint one identifier NFT from their own nonce. */
export function buildIdentifierThreadMintTx(
  lucid: LucidEvolution,
  thread: IdentifierThreadMint,
) {
  return lucid.newTx()
    .collectFrom([thread.nonceUtxo], Data.void())
    .attach.MintingPolicy(thread.mintingPolicy)
    .mintAssets({ [thread.tokenUnit]: 1n }, thread.encodedRedeemer)
    .pay.ToContract(
      thread.address,
      { kind: "inline", value: thread.encodedDatum },
      { [thread.tokenUnit]: 1n },
    );
}

/**
 * Pay the fee and minimum ADA from the nonce alone. Without coin selection the
 * transaction spends no shared wallet input, so every thread mint can be in the
 * mempool at once.
 */
export const IDENTIFIER_THREAD_COMPLETE_OPTIONS = {
  coinSelection: false,
} as const;
