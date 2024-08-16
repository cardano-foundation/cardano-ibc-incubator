import * as CSL from "@emurgo/cardano-serialization-lib-browser";
import { CSLIterator } from "./CSLIterator";

function getAllPolicyIdAssetNames(
  value: CSL.Value,
): [CSL.ScriptHash, CSL.AssetName][] {
  let ret: [CSL.ScriptHash, CSL.AssetName][] = [];
  let multiasset = value.multiasset() || CSL.MultiAsset.new();

  let policyIds = new CSLIterator(multiasset.keys());

  for (let policyId of policyIds) {
    let assets = multiasset.get(policyId) || CSL.Assets.new();

    let assetNames = new CSLIterator(assets.keys());
    for (let assetName of assetNames) {
      ret.push([policyId, assetName]);
    }
  }
  return ret;
}

export function getPureAdaUtxos(
  utxos: CSL.TransactionUnspentOutput[],
): CSL.TransactionUnspentOutput[] {
  let ret: CSL.TransactionUnspentOutput[] = [];

  for (let utxo of utxos) {
    let multiasset = utxo.output().amount().multiasset();
    if (multiasset != null && multiasset.len() > 0) continue;

    ret.push(utxo);
  }
  return ret;
}

export function getUtxosAddingUpToTarget(
  utxos: CSL.TransactionUnspentOutput[],
  target: CSL.Value,
): CSL.TransactionUnspentOutput[] | null {
  let policyIdAssetNames = getAllPolicyIdAssetNames(target);

  let ret: CSL.TransactionUnspentOutput[] = [];
  let sum = CSL.Value.new(CSL.BigNum.zero());

  for (let utxo of utxos) {
    let value = utxo.output().amount();
    ret.push(utxo);
    sum = sum.checked_add(value);

    if (sum.coin().less_than(target.coin())) {
      continue;
    }

    let sumAddsUpToTarget = true;
    for (let [policyId, assetName] of policyIdAssetNames) {
      let sumAsset =
        sum.multiasset()?.get_asset(policyId, assetName) || CSL.BigNum.zero();
      let targetAsset =
        target.multiasset()?.get_asset(policyId, assetName) ||
        CSL.BigNum.zero();
      if (sumAsset.less_than(targetAsset)) {
        sumAddsUpToTarget = false;
        break;
      }
    }
    if (sumAddsUpToTarget) {
      return ret;
    }
  }
  return null;
}

export function sumUtxos(utxos: CSL.TransactionUnspentOutput[]): CSL.Value {
  let sum = CSL.Value.new(CSL.BigNum.zero());
  for (let utxo of utxos) {
    sum = sum.checked_add(utxo.output().amount());
  }
  return sum;
}

const UNKNOWN_KEYHASH: CSL.Ed25519KeyHash = CSL.Ed25519KeyHash.from_bytes(
  new Uint8Array(new Array(28).fill(0)),
);

export async function getRequiredKeyHashes(
  tx: CSL.Transaction,
  utxos: CSL.TransactionUnspentOutput[],
  paymentKeyHash: CSL.Ed25519KeyHash,
): Promise<CSL.Ed25519KeyHash[]> {
  const txBody = tx.body();

  let result: CSL.Ed25519KeyHash[] = [];

  // get key hashes from inputs
  const inputs = txBody.inputs();
  for (let input of new CSLIterator(inputs)) {
    if (findUtxo(input, utxos) != null) {
      result.push(paymentKeyHash);
    } else {
      result.push(UNKNOWN_KEYHASH);
    }
  }

  // get keyHashes from collateral
  const collateral = txBody.collateral();
  for (let c of new CSLIterator(collateral)) {
    if (findUtxo(c, utxos) != null) {
      result.push(paymentKeyHash);
    } else {
      result.push(UNKNOWN_KEYHASH);
    }
  }

  // key hashes from withdrawals
  const withdrawals = txBody.withdrawals();
  const rewardAddresses = withdrawals?.keys();
  for (let rewardAddress of new CSLIterator(rewardAddresses)) {
    const credential = rewardAddress.payment_cred();
    if (credential.kind() === CSL.StakeCredKind.Key) {
      result.push(credential.to_keyhash()!);
    }
  }

  // get key hashes from certificates
  let txCerts = txBody.certs();
  if (txCerts != null) {
    for (let cert of new CSLIterator(txCerts)) {
      result.push(...getRequiredKeyHashesFromCertificate(cert));
    }
  }

  // get key hashes from scripts
  const scripts = tx.witness_set().native_scripts();
  for (let script of new CSLIterator(scripts)) {
    result.push(...new CSLIterator(script.get_required_signers()));
  }

  // get keyHashes from required signers
  const requiredSigners = txBody.required_signers();
  for (let requiredSigner of new CSLIterator(requiredSigners)) {
    result.push(requiredSigner);
  }

  return result;
}

export function findUtxo(
  txInput: CSL.TransactionInput,
  utxos: CSL.TransactionUnspentOutput[],
): CSL.TransactionUnspentOutput | null {
  let txHash = txInput.transaction_id().to_hex();
  let index = txInput.index();
  for (let utxo of utxos) {
    if (
      utxo.input().transaction_id().to_hex() === txHash &&
      utxo.input().index() === index
    ) {
      return utxo;
    }
  }
  return null;
}

export function getRequiredKeyHashesFromCertificate(
  cert: CSL.Certificate,
): CSL.Ed25519KeyHash[] {
  let result: CSL.Ed25519KeyHash[] = [];

  if (cert.kind() === CSL.CertificateKind.StakeRegistration) {
    // stake registration doesn't required signing
  } else if (cert.kind() === CSL.CertificateKind.StakeDeregistration) {
    const credential = cert.as_stake_deregistration()!.stake_credential();
    if (credential.kind() === CSL.StakeCredKind.Key) {
      result.push(credential.to_keyhash()!);
    }
  } else if (cert.kind() === CSL.CertificateKind.StakeDelegation) {
    const credential = cert.as_stake_delegation()!.stake_credential();
    if (credential.kind() === CSL.StakeCredKind.Key) {
      result.push(credential.to_keyhash()!);
    }
  } else if (cert.kind() === CSL.CertificateKind.PoolRegistration) {
    const owners = cert.as_pool_registration()!.pool_params().pool_owners();
    for (let i = 0; i < owners.len(); i++) {
      const ownerKeyhash = owners.get(i);
      result.push(ownerKeyhash);
    }
  } else if (cert.kind() === CSL.CertificateKind.PoolRetirement) {
    const operator = cert.as_pool_retirement()!.pool_keyhash();
    result.push(operator);
  } else if (cert.kind() === CSL.CertificateKind.MoveInstantaneousRewardsCert) {
    const instant_reward = cert
      .as_move_instantaneous_rewards_cert()!
      .move_instantaneous_reward()
      .as_to_stake_creds()!
      .keys();
    for (let credential of new CSLIterator(instant_reward)) {
      if (credential.kind() === CSL.StakeCredKind.Key) {
        result.push(credential.to_keyhash()!);
      }
    }
  } else {
    // We don't know how to handle other certificate types
    result.push(UNKNOWN_KEYHASH);
  }
  return result;
}
