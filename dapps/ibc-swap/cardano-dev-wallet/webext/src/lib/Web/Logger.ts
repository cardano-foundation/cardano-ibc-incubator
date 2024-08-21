import { Logger } from "../CIP30";
import { WebextBridgeClient, WebextBridgeServer } from "./WebextBridge";

class RemoteLogger implements Logger {
  bridge: WebextBridgeClient;
  nextId: number;

  constructor(bridge: WebextBridgeClient) {
    this.bridge = bridge;
    this.nextId = 0;
  }

  _getNextId(): number {
    let id = this.nextId;
    this.nextId += 1;
    return id;
  }

  async log(id: number | null, log: string): Promise<number> {
    if (id == null) id = this._getNextId();

    await this.bridge.request("cdw/logger/log", { id, log });

    return id;
  }
}

class RemoteLoggerServer {
  bridge: WebextBridgeServer;
  port: chrome.runtime.Port | null;

  constructor(bridge: WebextBridgeServer) {
    this.bridge = bridge;
    this.port = null;

    this.bridge.register("cdw/logger/log", async ({ id, log }) => {
      if (this.port != null)
        this.port.postMessage({ method: "popup/log", id, log });
    });
  }

  start() {
    this.port = chrome.runtime.connect();
    this.port.onDisconnect.addListener(() => {
      this.port = null;
      setTimeout(this.start, 1000);
    });
  }
}

export { RemoteLogger, RemoteLoggerServer };
