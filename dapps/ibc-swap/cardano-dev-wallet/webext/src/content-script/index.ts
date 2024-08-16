import * as CIP30 from "../lib/CIP30";
import { RemoteLogger } from "../lib/Web/Logger";
import { WebextRemoteStorage } from "../lib/Web/Storage";
import { WebextBridgeClient } from "../lib/Web/WebextBridge";

declare global {
  interface Window {
    cardano?: any;
  }
}

if (window.cardano == null) {
  window.cardano = {};
}

let bridge = new WebextBridgeClient("cdw-contentscript-bridge");
bridge.start()

let store = new WebextRemoteStorage(bridge);

let logger = new RemoteLogger(bridge);
CIP30.CIP30Entrypoint.init(store, logger);

let entryPoint = CIP30.CIP30Entrypoint;

window.cardano.DevWallet = entryPoint;
window.cardano.nami = entryPoint;


console.log("Injected into nami and DevWallet", window.cardano)
