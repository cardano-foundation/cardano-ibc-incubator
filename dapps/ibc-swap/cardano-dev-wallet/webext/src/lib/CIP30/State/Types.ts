type Backend =
  | {
    type: "blockfrost";
    name: string,
    projectId: string;
    url?: string;
  }
  | {
    type: "ogmios_kupo";
    name: string,
    ogmiosUrl: string;
    kupoUrl: string;
  };

interface RootKey {
  name: string;
  keyBech32: string;
}

interface Account {
  name: string;
  keyId: string;
  accountIdx: number;
}

interface Overrides {
  balance: string | null;
  hiddenUtxos: Utxo[];
  hiddenCollateral: Utxo[];
}

interface Utxo {
  txHashHex: string;
  idx: number;
}

export type { Backend, RootKey, Account, Overrides, Utxo }
