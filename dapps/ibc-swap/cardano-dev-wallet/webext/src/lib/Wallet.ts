import * as bip39 from "bip39";
import * as CSL from "@emurgo/cardano-serialization-lib-browser";

export class Wallet {
  rootKey: CSL.Bip32PrivateKey;
  networkId: number;

  constructor(
    params: { networkId: number } & (
      | { mnemonics: string[] }
      | { privateKey: string }
    ),
  ) {
    this.networkId = params.networkId;
    if ("mnemonics" in params) {
      const entropy = bip39.mnemonicToEntropy(params.mnemonics.join(" "));
      this.rootKey = CSL.Bip32PrivateKey.from_bip39_entropy(
        Buffer.from(entropy, "hex"),
        Buffer.from(""), // password
      );
    } else {
      this.rootKey = CSL.Bip32PrivateKey.from_bech32(params.privateKey);
    }
  }

  account(account: number, index: number): Account {
    let accountKey = this.rootKey
      .derive(harden(1852))
      .derive(harden(1815))
      .derive(harden(account));
    return new Account(this.networkId, accountKey, index);
  }
}

export class Account {
  networkId: number;
  index: number;
  paymentKey: CSL.PrivateKey;
  stakingKey: CSL.PrivateKey;
  baseAddress: CSL.BaseAddress;

  constructor(
    networkId: number,
    accountKey: CSL.Bip32PrivateKey,
    index: number,
  ) {
    this.networkId = networkId;
    this.index = index;

    this.paymentKey = accountKey.derive(0).derive(index).to_raw_key();
    this.stakingKey = accountKey.derive(2).derive(index).to_raw_key();
    this.baseAddress = CSL.BaseAddress.new(
      this.networkId,
      CSL.StakeCredential.from_keyhash(this.paymentKey.to_public().hash()),
      CSL.StakeCredential.from_keyhash(this.stakingKey.to_public().hash()),
    );
  }
}

function harden(num: number): number {
  return 0x80000000 + num;
}
