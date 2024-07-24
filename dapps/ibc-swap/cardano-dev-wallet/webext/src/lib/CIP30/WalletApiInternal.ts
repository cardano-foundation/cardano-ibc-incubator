import { Paginate, WalletApiExtension } from "./Types";
import * as CSL from "@emurgo/cardano-serialization-lib-browser";
import * as CMS from "@emurgo/cardano-message-signing-browser";
import * as Utils from "../Utils";
import { Account } from "../Wallet";
import {
  HexStr,
  DataSignature,
  TxSignError,
  TxSignErrorCode,
  Backend,
  NetworkId,
  DataSignError,
  DataSignErrorCode,
} from ".";

import { paginateClientSide } from "./Utils";
import { State, Utxo } from "./State";
import { Big } from "big.js";

class WalletApiInternal {
  account: Account;
  backend: Backend;
  networkId: NetworkId;
  state: State;
  overridesEnabled: boolean;

  constructor(
    account: Account,
    backend: Backend,
    networkId: NetworkId,
    state: State,
    overridesEnabled: boolean,
  ) {
    this.account = account;
    this.backend = backend;
    this.networkId = networkId;
    this.state = state;
    this.overridesEnabled = overridesEnabled;
  }

  _getBaseAddress(): CSL.BaseAddress {
    return this.account.baseAddress;
  }

  _getAddress(): CSL.Address {
    return this._getBaseAddress().to_address();
  }

  async getNetworkId(): Promise<NetworkId> {
    return this.networkId;
  }

  async getExtensions(): Promise<WalletApiExtension[]> {
    return [];
  }

  async getUtxos(
    amount?: CSL.Value,
    paginate?: Paginate,
  ): Promise<CSL.TransactionUnspentOutput[] | null> {
    let networkActive = await this.state.networkActiveGet();
    let address = this._getAddress();

    let utxos = await this.backend.getUtxos(address);
    if (this.overridesEnabled) {
      let overrides = await this.state.overridesGet(networkActive);
      if (overrides != null) {
        utxos = filterUtxos(utxos, overrides.hiddenUtxos);
      }
    }

    if (amount != null) {
      let res = Utils.getUtxosAddingUpToTarget(utxos, amount);
      if (res == null) return null;
      utxos = res;
    }

    return paginateClientSide(utxos, paginate);
  }

  async getBalance(): Promise<CSL.Value> {
    let networkActive = await this.state.networkActiveGet();

    if (this.overridesEnabled) {
      let overrides = await this.state.overridesGet(networkActive);
      if (overrides?.balance != null) {
        try {
          let balance = new Big(overrides.balance);
          balance = balance.mul("1000000");
          return CSL.Value.new(
            CSL.BigNum.from_str(balance.toFixed(0, Big.roundDown)),
          );
        } catch (e) {
          console.error("Can't parse balance override", e, overrides.balance);
        }
      }
    }

    let address = this._getAddress();
    let utxos = await this.backend.getUtxos(address);

    let overrides = await this.state.overridesGet(networkActive);
    if (overrides != null) {
      utxos = filterUtxos(utxos, overrides.hiddenUtxos);
    }

    return Utils.sumUtxos(utxos);
  }

  async getCollateral(params?: {
    amount?: CSL.BigNum;
  }): Promise<CSL.TransactionUnspentOutput[] | null> {
    let networkActive = await this.state.networkActiveGet();
    const fiveAda = CSL.BigNum.from_str("5000000");

    let address = this._getAddress();

    let target = params?.amount || null;

    if (target == null || target.compare(fiveAda) > 1) {
      target = fiveAda;
    }

    let utxos: CSL.TransactionUnspentOutput[] | null =
      await this.backend.getUtxos(address);

    if (this.overridesEnabled) {
      let overrides = await this.state.overridesGet(networkActive);
      if (overrides != null) {
        utxos = filterUtxos(utxos, overrides.hiddenCollateral);
      }
    }

    utxos = Utils.getPureAdaUtxos(utxos);

    if (params?.amount != null) {
      let value = CSL.Value.new(params.amount);
      utxos = Utils.getUtxosAddingUpToTarget(utxos, value);
    }
    return utxos;
  }

  async getChangeAddress(): Promise<CSL.Address> {
    return this._getAddress();
  }

  async getUsedAddresses(_paginate?: Paginate): Promise<CSL.Address[]> {
    return [this._getAddress()];
  }

  async getUnusedAddresses(): Promise<CSL.Address[]> {
    return [];
  }

  async getRewardAddresses(): Promise<CSL.Address[]> {
    return [this._getAddress()];
  }

  async signTx(
    tx: CSL.Transaction,
    partialSign: boolean,
  ): Promise<CSL.TransactionWitnessSet> {
    let txBody = tx.body();
    let txHash = CSL.hash_transaction(txBody);

    let account = this.account;
    let paymentKeyHash = account.paymentKey.to_public().hash();
    let stakingKeyHash = account.stakingKey.to_public().hash();

    let requiredKeyHashes = await Utils.getRequiredKeyHashes(
      tx,
      (await this.getUtxos())!,
      paymentKeyHash,
    );

    let requiredKeyHashesSet = new Set(requiredKeyHashes);

    let witnesses: CSL.Vkeywitness[] = [];
    for (let keyhash of requiredKeyHashesSet) {
      if (keyhash.to_hex() == paymentKeyHash.to_hex()) {
        let witness = CSL.make_vkey_witness(txHash, account.paymentKey);
        witnesses.push(witness);
      } else if (keyhash.to_hex() == stakingKeyHash.to_hex()) {
        let witness = CSL.make_vkey_witness(txHash, account.stakingKey);
        witnesses.push(witness);
      } else {
        if (partialSign == false) {
          throw {
            code: TxSignErrorCode.ProofGeneration,
            info: `Unknown keyhash ${keyhash.to_hex()}`,
          };
        }
      }
    }

    let witness_set = tx.witness_set();
    let vkeys = witness_set.vkeys();
    if (vkeys == null) {
      vkeys = CSL.Vkeywitnesses.new();
    }
    for (let witness of witnesses) {
      vkeys.add(witness);
    }
    witness_set.set_vkeys(vkeys);

    return witness_set;
  }

  async signData(addr: CSL.Address, payload: HexStr): Promise<DataSignature> {
    let account = this.account;
    let paymentKey = account.paymentKey;
    let stakingKey = account.stakingKey;
    let keyToSign: CSL.PrivateKey;

    let paymentAddressFns = [
      ["BaseAddress", CSL.BaseAddress],
      ["EnterpriseAddress", CSL.EnterpriseAddress],
      ["PointerAddress", CSL.PointerAddress],
    ] as const;

    let addressStakeCred: CSL.StakeCredential | null = null;
    for (let [_name, fn] of paymentAddressFns) {
      let addrDowncasted = fn.from_address(addr);
      if (addrDowncasted != null) {
        addressStakeCred = addrDowncasted.payment_cred();
        break;
      }
    }

    if (addressStakeCred == null) {
      let addrDowncasted = CSL.RewardAddress.from_address(addr);
      if (addrDowncasted != null) {
        addressStakeCred = account.baseAddress.stake_cred();
      }
    }

    if (addressStakeCred == null) {
      throw new Error(
        "This should be unreachable unless CSL adds a new address type",
      );
    }

    let addressKeyhash = addressStakeCred.to_keyhash()!.to_hex();

    if (addressKeyhash == paymentKey.to_public().hash().to_hex()) {
      keyToSign = paymentKey;
    } else if (addressKeyhash == stakingKey.to_public().hash().to_hex()) {
      keyToSign = stakingKey;
    } else {
      let err: DataSignError = {
        code: DataSignErrorCode.ProofGeneration,
        info: "We don't own the keyhash: " + addressKeyhash,
      };
      throw err;
    }

    // Headers:
    // alg (1): EdDSA (-8)
    // kid (4): ignore, nami doesn't set it
    // "address": raw bytes of address
    //
    // Don't hash payload
    // Don't use External AAD

    let protectedHeaders = CMS.HeaderMap.new();
    protectedHeaders.set_algorithm_id(
      CMS.Label.from_algorithm_id(CMS.AlgorithmId.EdDSA),
    );
    protectedHeaders.set_header(
      CMS.Label.new_text("address"),
      CMS.CBORValue.new_bytes(addr.to_bytes()),
    );
    let protectedHeadersWrapped = CMS.ProtectedHeaderMap.new(protectedHeaders);

    let unprotectedHeaders = CMS.HeaderMap.new();

    let headers = CMS.Headers.new(protectedHeadersWrapped, unprotectedHeaders);

    let builder = CMS.COSESign1Builder.new(
      headers,
      Buffer.from(payload, "hex"),
      false,
    );
    let toSign = builder.make_data_to_sign().to_bytes();
    keyToSign.sign(toSign);

    let coseSign1 = builder.build(keyToSign.sign(toSign).to_bytes());

    let coseKey = CMS.COSEKey.new(CMS.Label.from_key_type(CMS.KeyType.OKP));
    coseKey.set_algorithm_id(
      CMS.Label.from_algorithm_id(CMS.AlgorithmId.EdDSA),
    );
    coseKey.set_header(
      CMS.Label.new_int(CMS.Int.new_negative(CMS.BigNum.from_str("1"))),
      CMS.CBORValue.new_int(CMS.Int.new_i32(6)), // CMS.CurveType.Ed25519
    ); // crv (-1) set to Ed25519 (6)
    coseKey.set_header(
      CMS.Label.new_int(CMS.Int.new_negative(CMS.BigNum.from_str("2"))),
      CMS.CBORValue.new_bytes(keyToSign.to_public().as_bytes()),
    ); // x (-2) set to public key

    return {
      signature: Buffer.from(coseSign1.to_bytes()).toString("hex"),
      key: Buffer.from(coseKey.to_bytes()).toString("hex"),
    };
  }

  async submitTx(tx: string): Promise<string> {
    return this.backend.submitTx(tx);
  }
}

function filterUtxos(
  utxos: CSL.TransactionUnspentOutput[],
  hiddenUtxos: Utxo[],
) {
  utxos = utxos.filter((utxo) => {
    for (let utxo1 of hiddenUtxos) {
      if (
        utxo.input().index() == utxo1.idx &&
        utxo.input().transaction_id().to_hex() == utxo1.txHashHex
      ) {
        return false;
      }
    }
    return true;
  });
  return utxos;
}

function cloneTx(tx: CSL.Transaction): CSL.Transaction {
  return CSL.Transaction.from_bytes(tx.to_bytes());
}

export { WalletApiInternal };
