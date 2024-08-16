import { Store } from "../CIP30/State";
import { WebextBridgeClient, WebextBridgeServer } from "./WebextBridge";

class WebextStorage implements Store {
  async set(key: string, value: any): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async get(key: string): Promise<any> {
    return (await chrome.storage.local.get(key))[key];
  }
}

class WebStorage implements Store {
  async set(key: string, value: any): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value));
  }

  async get(key: string): Promise<any> {
    let val = localStorage.getItem(key);
    if (val == null) return null;
    return JSON.parse(val);
  }
}

class WebextRemoteStorage implements Store {
  bridge: WebextBridgeClient;

  constructor(bridge: WebextBridgeClient) {
    this.bridge = bridge;
  }

  static initServer(bridge: WebextBridgeServer, base: Store) {
    bridge.register("cdw/storage/get", async ({ key }) => {
      let value = await base.get(key);
      return value;
    });
    bridge.register("cdw/storage/set", async ({ key, value }) => {
      await base.set(key, value);
    });
  }

  async set(key: string, value: any): Promise<void> {
    await this.bridge.request("cdw/storage/set", { key, value });
  }

  async get(key: string): Promise<any> {
    let value = await this.bridge.request("cdw/storage/get", { key });
    return value;
  }
}

export { WebStorage, WebextStorage, WebextRemoteStorage };
