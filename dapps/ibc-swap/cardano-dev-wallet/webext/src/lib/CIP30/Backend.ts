import * as CSL from "@emurgo/cardano-serialization-lib-browser";

interface Backend {
  getUtxos(address: CSL.Address): Promise<CSL.TransactionUnspentOutput[]>;
  submitTx(tx: string): Promise<string>;
}

export { type Backend };
