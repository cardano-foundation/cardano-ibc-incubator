import { PlutusData } from "@dcspark/cardano-multiplatform-multiera-lib-nodejs";

export class TokenAsset {
    name: string;
    quantity: bigint;
    constructor(name: string, quantity: bigint) {
      this.name = name;
      this.quantity = quantity;
    }
  }
  
  export class TxOutput {
    hash: string;
    txIndex: number;
    outputIndex: number;
    address: string;
    datum: string;
    fee: bigint;
    datum_plutus: PlutusData;
    assets: Map<string, TokenAsset[]>;
  
    constructor(
      hash: string,
      txIndex: number,
      outputIndex: number,
      address: string,
      datum: string,
      fee: bigint,
      datum_plutus: PlutusData,
      assets: Map<string, TokenAsset[]>
    ) {
      this.hash = hash;
      this.txIndex = txIndex;
      this.outputIndex = outputIndex;
      this.address = address;
      this.datum = datum;
      this.fee = fee;
      this.datum_plutus = datum_plutus;
      this.assets = assets;
    }
  }