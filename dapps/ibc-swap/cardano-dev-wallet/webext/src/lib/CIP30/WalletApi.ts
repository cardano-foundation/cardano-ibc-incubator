import * as CSL from "@emurgo/cardano-serialization-lib-browser";

import {
  WalletApiExtension,
  CborHexStr,
  AddressHexStr,
  Paginate,
  HexStr,
  DataSignature,
  AddressInputStr,
  NetworkId,
  WalletApiInternal,
  APIError,
  APIErrorCode,
  NetworkName,
} from ".";
import { State } from "./State";

function jsonReplacerCSL(_key: string, value: any) {
  if (value == null) return null;

  if (value.to_js_value != null) {
    return value.to_js_value();
  } else if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  } else if (value instanceof Error) {
    console.error("Error: ", value);
    return value.name + ": " + value.message;
  }
  return value;
}

interface Logger {
  log(idx: number | null, log: string): Promise<number>;
}

class WalletApi {
  api: WalletApiInternal;
  state: State;
  logger: Logger;
  network: NetworkName;
  accountId: string;

  constructor(
    api: WalletApiInternal,
    state: State,
    logger: Logger,
    accountId: string,
    network: NetworkName,
  ) {
    this.api = api;
    this.state = state;
    this.logger = logger;
    this.network = network;
    this.accountId = accountId;
  }

  /* Use this function instead of the constructor.
   * Although this is not specified in the spec, some dApps seem to be passing
   * around the WalletApi object like this:
   *      `let copy = {...wallet}`
   * which may not work for when wallet is not a plain object.
   * This function returns a plain object instead.
   */
  static getNew(
    api: WalletApiInternal,
    state: State,
    logger: Logger,
    accountId: string,
    network: NetworkName,
  ) {
    let walletApi = new WalletApi(api, state, logger, accountId, network);

    return {
      // @ts-ignore
      getNetworkId: (...args: any[]) => walletApi.getNetworkId(...args),
      // @ts-ignore
      getExtensions: (...args: any[]) => walletApi.getExtensions(...args),
      getUtxos: (...args: any[]) => walletApi.getUtxos(...args),
      // @ts-ignore
      getBalance: (...args: any[]) => walletApi.getBalance(...args),
      getCollateral: (...args: any[]) => walletApi.getCollateral(...args),
      getUsedAddresses: (...args: any[]) => walletApi.getUsedAddresses(...args),
      getUnusedAddresses: (...args: any[]) =>
        // @ts-ignore
        walletApi.getUnusedAddresses(...args),
      // @ts-ignore
      getChangeAddress: (...args: any[]) => walletApi.getChangeAddress(...args),
      getRewardAddresses: (...args: any[]) =>
        // @ts-ignore
        walletApi.getRewardAddresses(...args),
      // @ts-ignore
      signTx: (...args: any[]) => walletApi.signTx(...args),
      // @ts-ignore
      signData: (...args: any[]) => walletApi.signData(...args),
      // @ts-ignore
      submitTx: (...args: any[]) => walletApi.submitTx(...args),
    } as const;
  }

  async ensureAccountNotChanged() {
    let networkActive = await this.state.networkActiveGet();
    if (networkActive != this.network) {
      let err: APIError = {
        code: APIErrorCode.AccountChange,
        info: "Account was changed by the user. Please reconnect to the Wallet",
      };
      throw err;
    }

    let activeAccountId = await this.state.accountsActiveGet(networkActive);
    if (activeAccountId != this.accountId) {
      let err: APIError = {
        code: APIErrorCode.AccountChange,
        info: "Account was changed by the user. Please reconnect to the Wallet",
      };
      throw err;
    }
  }

  async logCall(
    fn: string,
    argsDecoded: readonly any[] = [],
    args: readonly any[] = [],
  ): Promise<number> {
    if (args.length == 0) {
      args = argsDecoded;
      argsDecoded = [];
    }

    let log =
      fn +
      "(" +
      args
        .map((p) =>
          JSON.stringify(
            p,
            (_k, v) => {
              if (v == null) return null; // undefined|null -> null
              return v;
            },
            2,
          ),
        )
        .join(", ") +
      ")";

    let idx = await this.logger.log(null, log);
    if (argsDecoded.length > 0) {
      log =
        "Decoded: " +
        fn +
        "(" +
        argsDecoded
          .map((p) => JSON.stringify(p, jsonReplacerCSL, 2))
          .join(", ") +
        ")";
      await this.logger.log(idx, log);
    }

    return idx;
  }

  async logReturn(idx: number, value: any, valueDecoded?: any) {
    let log = "return " + JSON.stringify(value, jsonReplacerCSL, 2);
    await this.logger.log(idx, log);

    if (valueDecoded != null) {
      log =
        "Decoded: return " + JSON.stringify(valueDecoded, jsonReplacerCSL, 2);
      await this.logger.log(idx, log);
    }
  }

  async logError(idx: number, error: any) {
    let log = "error " + JSON.stringify(error, jsonReplacerCSL, 2);
    await this.logger.log(idx, log);
  }

  async wrapCall<T extends unknown[], U>(
    fnName: string,
    fn: () => Promise<U>,
  ): Promise<U>;

  async wrapCall<T extends unknown[], U, V>(
    fnName: string,
    fn: () => Promise<U>,
    opts: {
      returnEncoder: (value: U) => V;
    },
  ): Promise<V>;

  async wrapCall<T extends unknown[], U>(
    fnName: string,
    fn: (...argsDecoded: T) => Promise<U>,
    opts: {
      argsDecoded: T;
      args?: any[];
    },
  ): Promise<U>;

  async wrapCall<T extends unknown[], U, V>(
    fnName: string,
    fn: (...argsDecoded: T) => Promise<U>,
    opts: {
      returnEncoder: (value: U) => V;
      argsDecoded: T;
      args?: any[];
    },
  ): Promise<V>;

  async wrapCall<T extends unknown[], U, V>(
    fnName: string,
    fn: (...argsDecoded: T) => Promise<U>,
    opts: {
      argsDecoded?: T;
      args?: T | any[];
      returnEncoder?: (value: U) => V;
    } = {},
  ): Promise<U | V> {
    let { argsDecoded, args, returnEncoder } = opts;

    let idx = await this.logCall(fnName, argsDecoded, args);
    try {
      await this.ensureAccountNotChanged();

      if (argsDecoded == null) {
        argsDecoded = [] as unknown[] as T;
      }
      let ret: U | V = await fn.call(this.api, ...argsDecoded);
      let retDecoded = null;

      if (returnEncoder != null) {
        retDecoded = ret;
        ret = returnEncoder(retDecoded);
      }

      await this.logReturn(idx, ret, retDecoded);

      return ret;
    } catch (e) {
      this.logError(idx, e);
      throw e;
    }
  }

  async getNetworkId(): Promise<NetworkId> {
    return this.wrapCall("getNetworkId", this.api.getNetworkId);
  }

  async getExtensions(): Promise<WalletApiExtension[]> {
    return this.wrapCall("getExtensions", this.api.getExtensions);
  }

  async getUtxos(
    amount?: CborHexStr,
    paginate?: Paginate,
  ): Promise<CborHexStr[] | null> {
    let args = [];

    let argsDecoded: [] | [CSL.Value] | [CSL.Value, Paginate] = [];

    if (amount !== undefined) {
      args.push(amount);
      argsDecoded = [CSL.Value.from_hex(amount)];

      if (paginate != undefined) {
        args.push(paginate);
        argsDecoded = [...argsDecoded, paginate];
      }
    }

    return await this.wrapCall("getUtxos", this.api.getUtxos, {
      argsDecoded,
      args,
      returnEncoder: (utxos: CSL.TransactionUnspentOutput[] | null) => {
        if (utxos == null) return null;
        return utxos.map((utxo) => utxo.to_hex());
      },
    });
  }

  async getBalance(): Promise<CborHexStr> {
    return this.wrapCall("getBalance", this.api.getBalance, {
      returnEncoder: (balance) => balance.to_hex(),
    });
  }

  async getCollateral(options?: {
    amount: CborHexStr;
  }): Promise<CborHexStr[] | null> {
    let argsDecoded: [params?: { amount: CSL.BigNum }] = [];
    if (options != null) {
      let amount = CSL.BigNum.from_hex(options.amount);

      argsDecoded.push({
        amount,
      });
    }

    return this.wrapCall("getCollateral", this.api.getCollateral, {
      argsDecoded,
      args: [options],
      returnEncoder: (collaterals: CSL.TransactionUnspentOutput[] | null) =>
        collaterals == null ? null : collaterals.map((c) => c.to_hex()),
    });
  }

  async getUsedAddresses(paginate?: Paginate): Promise<AddressHexStr[]> {
    return this.wrapCall("getUsedAddresses", this.api.getUsedAddresses, {
      argsDecoded: [paginate],
      returnEncoder: (addresses: CSL.Address[]) =>
        addresses.map((address) => address.to_hex()),
    });
  }

  async getUnusedAddresses(): Promise<AddressHexStr[]> {
    return this.wrapCall("getUnusedAddresses", this.api.getUnusedAddresses, {
      returnEncoder: (addresses: CSL.Address[]) =>
        addresses.map((address) => address.to_hex()),
    });
  }

  async getChangeAddress(): Promise<AddressHexStr> {
    return this.wrapCall("getChangeAddress", this.api.getChangeAddress, {
      returnEncoder: (address) => address.to_hex(),
    });
  }

  async getRewardAddresses(): Promise<AddressHexStr[]> {
    return this.wrapCall("getRewardAddresses", this.api.getRewardAddresses, {
      returnEncoder: (addresses) =>
        addresses.map((address) => address.to_hex()),
    });
  }

  async signTx(
    tx: CborHexStr,
    partialSign: boolean = false,
  ): Promise<CborHexStr> {
    return await this.wrapCall("signTx", this.api.signTx, {
      argsDecoded: [CSL.Transaction.from_hex(tx), partialSign],
      args: [tx, partialSign],
      returnEncoder: (witnessSet: CSL.TransactionWitnessSet) =>
        witnessSet.to_hex(),
    });
  }

  async signData(
    addr: AddressInputStr,
    payload: HexStr,
  ): Promise<DataSignature> {
    let addrParsed: CSL.Address | null = null;
    try {
      addrParsed = CSL.Address.from_bech32(addr);
    } catch (e) {
      // not a bech32 address, try hex
    }
    if (addrParsed == null) {
      addrParsed = CSL.Address.from_hex(addr);
    }
    return this.wrapCall("signData", this.api.signData, {
      argsDecoded: [addrParsed, payload],
      args: [addr, payload],
    });
  }

  async submitTx(tx: CborHexStr): Promise<string> {
    return this.wrapCall("submitTx", this.api.submitTx, { argsDecoded: [tx] });
  }
}

export { WalletApi, type Logger };
