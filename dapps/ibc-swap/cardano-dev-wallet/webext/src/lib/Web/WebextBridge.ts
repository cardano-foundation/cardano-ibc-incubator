/**
 * Communicate between webpage and content script using DOM APIs (window.postMessage)
 */

export class WebextBridgeClient {
  id: string;

  requests: Map<number, (resp: any) => void>;
  nextRequestId: number;

  constructor(id: string) {
    this.id = id;
    this.requests = new Map();
    this.nextRequestId = 0;
  }

  start() {
    window.addEventListener("message", (ev) => {
      let data = ev.data;
      if (data.bridgeId != this.id) return;
      if (data.type != "response") return;

      let reqId = data.reqId as number | null | undefined;
      if (reqId == null) return;

      let resolve = this.requests.get(reqId);
      if (resolve == null) return;

      resolve(data.response);
    });
  }

  _getNextRequestId(): number {
    let id = this.nextRequestId;
    this.nextRequestId += 1;
    return id;
  }

  request(method: string, data: any) {
    let reqId = this._getNextRequestId();
    let promise = new Promise<void>((resolve) => {
      this.requests.set(reqId, resolve);
    });
    window.postMessage({
      bridgeId: this.id,
      reqId,
      type: "request",
      request: {
        method,
        data,
      },
    });
    return promise;
  }
}

export class WebextBridgeServer {
  id: string;

  handlers: Map<string, (data: any) => Promise<any>>;

  constructor(id: string) {
    this.id = id;
    this.handlers = new Map();
  }

  register(method: string, handler: (data: any) => Promise<any>) {
    this.handlers.set(method, handler);
  }

  start() {
    window.addEventListener("message", async (ev) => {
      let data = ev.data;
      if (data.bridgeId != this.id) return;

      if (data.type != "request") return;

      let reqId = data.reqId;

      let request = data.request;
      if (request == null) return;

      let handler = this.handlers.get(request.method);
      if (handler == null) return;

      let response = await handler(request.data);

      ev.source?.postMessage({
        bridgeId: this.id,
        reqId,
        type: "response",
        response,
      });
    });
  }
}
