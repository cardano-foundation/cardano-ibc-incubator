import { NetworkName } from "../Network";
import { HeirarchialStore, Store } from "./Store";

export * from "./Types";
export * from "./Store";

import { Account, Backend, Overrides, RootKey } from "./Types";

type Record<T> = { [key: string]: T };

class State {
  rootStore: HeirarchialStore;
  constructor(store: Store) {
    this.rootStore = new HeirarchialStore(store);
  }

  async networkActiveGet(): Promise<NetworkName> {
    let networkActive: NetworkName | null =
      await this.rootStore.get("networkActive");
    if (networkActive == null) {
      return NetworkName.Preview;
    }
    return networkActive;
  }

  async networkActiveSet(network: NetworkName) {
    await this.rootStore.set("networkActive", network);
  }

  async _getNetworkSubStore(network: NetworkName) {
    return this.rootStore.withPrefix(network);
  }

  async _recordsGet<T>(network: NetworkName, key: string): Promise<Record<T>> {
    let store = await this._getNetworkSubStore(network);
    let records = await store.get(key);
    if (records == null) return {};
    return records;
  }

  async _recordsAdd<T>(
    network: NetworkName,
    key: string,
    value: T,
  ): Promise<string> {
    let store = await this._getNetworkSubStore(network);
    let id: number | null = await store.get(key + "/nextId");
    if (id == null) id = 0;
    let records = await store.get(key);
    if (records == null) records = {};
    records[id] = value;
    await store.set(key, records);
    await store.set(key + "/nextId", id + 1);
    return id.toString();
  }

  async _recordsUpdate<T>(
    network: NetworkName,
    key: string,
    id: string,
    value: T,
  ) {
    let store = await this._getNetworkSubStore(network);
    let records = await store.get(key);
    records[id] = value;
    await store.set(key, records);
  }

  async _recordsDelete(network: NetworkName, key: string, id: string) {
    let store = await this._getNetworkSubStore(network);
    let records = await store.get(key);
    delete records[id];
    await store.set(key, records);
  }

  async rootKeysGet(network: NetworkName): Promise<Record<RootKey>> {
    return this._recordsGet(network, "rootKeys");
  }

  async rootKeysAdd(network: NetworkName, rootKey: RootKey): Promise<string> {
    return this._recordsAdd(network, "rootKeys", rootKey);
  }

  async rootKeysUpdate(network: NetworkName, id: string, rootKey: RootKey) {
    return this._recordsUpdate(network, "rootKeys", id, rootKey);
  }

  async rootKeysDelete(network: NetworkName, id: string) {
    return this._recordsDelete(network, "rootKeys", id);
  }

  async accountsGet(network: NetworkName): Promise<Record<Account>> {
    return this._recordsGet(network, "accounts");
  }

  async accountsAdd(network: NetworkName, account: Account): Promise<string> {
    return this._recordsAdd(network, "accounts", account);
  }

  async accountsUpdate(network: NetworkName, id: string, account: Account) {
    return this._recordsUpdate(network, "accounts", id, account);
  }

  async accountsDelete(network: NetworkName, id: string) {
    return this._recordsDelete(network, "accounts", id);
  }

  async accountsActiveGet(network: NetworkName): Promise<string | null> {
    let store = await this._getNetworkSubStore(network);
    let id = store.get("accounts/activeId");
    if (id == null) return null;
    return id;
  }

  async accountsActiveSet(network: NetworkName, id: string) {
    let store = await this._getNetworkSubStore(network);
    await store.set("accounts/activeId", id);
  }

  async backendsGet(network: NetworkName): Promise<Record<Backend>> {
    return this._recordsGet(network, "backends");
  }

  async backendsAdd(network: NetworkName, backend: Backend): Promise<string> {
    return this._recordsAdd(network, "backends", backend);
  }

  async backendsUpdate(network: NetworkName, id: string, backend: Backend) {
    return this._recordsUpdate(network, "backends", id, backend);
  }

  async backendsDelete(network: NetworkName, id: string) {
    return this._recordsDelete(network, "backends", id);
  }

  async backendsActiveGet(network: NetworkName): Promise<string | null> {
    let store = await this._getNetworkSubStore(network);
    let id = store.get("backends/activeId");
    if (id == null) return null;
    return id;
  }

  async backendsActiveSet(network: NetworkName, id: string) {
    let store = await this._getNetworkSubStore(network);
    await store.set("backends/activeId", id);
  }

  async overridesGet(network: NetworkName): Promise<Overrides> {
    let store = await this._getNetworkSubStore(network);
    let overrides = await store.get("overrides");
    if (overrides == null)
      return {
        balance: null,
        hiddenUtxos: [],
        hiddenCollateral: [],
      };
    return overrides;
  }

  async overridesSet(network: NetworkName, overrides: Overrides) {
    let store = await this._getNetworkSubStore(network);
    await store.set("overrides", overrides);
  }
}

export { State };
