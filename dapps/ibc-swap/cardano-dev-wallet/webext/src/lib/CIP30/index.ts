export * from "./Backend";
export * from "./ErrorTypes";
export * from "./Network";
export * from "./Types";
export * from "./WalletApi";
export * from "./WalletApiInternal";

import { Wallet } from "../Wallet";
import { Backend } from "./Backend";
import { WalletApi, Logger } from "./WalletApi";

import WalletIcon from "./Icon";
import { WalletApiInternal } from "./WalletApiInternal";
import { State, Store } from "./State";
import { APIError, APIErrorCode } from "./ErrorTypes";
import { networkNameToId } from "./Network";
import { BlockFrostBackend } from "./Backends/Blockfrost";
import { OgmiosKupoBackend } from "./Backends/OgmiosKupo";

/**
 * CIP30 Entrypoint.
 */
const CIP30Entrypoint = {
  apiVersion: "1",
  supportedExtensions: [],
  name: "Cardano Dev Wallet",
  icon: WalletIcon,

  state: null as State | null,
  logger: null as Logger | null,

  init(store: Store, logger: Logger) {
    CIP30Entrypoint.state = new State(store);
    CIP30Entrypoint.logger = logger;
  },

  isEnabled: async () => {
    return true;
  },

  enable: async () => {
    let state = CIP30Entrypoint.state!;
    let logger = CIP30Entrypoint.logger!;
    // Fetch active network
    let networkName = await state.networkActiveGet();
    let networkId = networkNameToId(networkName);

    // Fetch active account
    let accountId = await state.accountsActiveGet(networkName);
    if (accountId == null) {
      let err: APIError = {
        code: APIErrorCode.Refused,
        info: "Please configure the active account in the extension",
      };
      throw err;
    }

    let accounts = await state.accountsGet(networkName);
    let accountInfo = accounts[accountId];
    let keys = await state.rootKeysGet(networkName);
    let keyInfo = keys[accountInfo.keyId];

    let wallet = new Wallet({ networkId, privateKey: keyInfo.keyBech32 });
    let account = wallet.account(accountInfo.accountIdx, 0);

    // Fetch active backend
    let backendId = await state.backendsActiveGet(networkName);
    if (backendId == null) {
      let err: APIError = {
        code: APIErrorCode.Refused,
        info: "Please configure the active backend in the extension",
      };
      throw err;
    }

    let backends = await state.backendsGet(networkName);
    let backendInfo = backends[backendId];
    let backend: Backend;
    if (backendInfo.type == "blockfrost") {
      backend = new BlockFrostBackend(backendInfo.projectId, backendInfo.url);
    } else if (backendInfo.type == "ogmios_kupo") {
      backend = new OgmiosKupoBackend(backendInfo);
    } else {
      throw new Error("Unreachable");
    }

    // Construct api
    let apiInternal = new WalletApiInternal(
      account,
      backend,
      networkId,
      state,
      true,
    );

    let api = WalletApi.getNew(
      apiInternal,
      state,
      logger,
      accountId,
      networkName,
    );
    return api;
  },
};

export { CIP30Entrypoint };
