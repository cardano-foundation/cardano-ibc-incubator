import { Injectable } from '@nestjs/common';

export type GatewayEventAttribute = {
  key: string;
  value: string;
};

export type GatewayEvent = {
  type: string;
  attributes: GatewayEventAttribute[];
};

@Injectable()
export class TxEventsService {
  private readonly eventsByTxHash = new Map<string, GatewayEvent[]>();
  private readonly eventsByExpectedRoot = new Map<string, GatewayEvent[]>();

  register(txHash: string, events: GatewayEvent[]): void {
    if (!txHash) return;
    // Hermes signs the unsigned CBOR, so the final tx hash changes.
    // We key by lowercased hash to maximize lookup success, but a synthetic
    // fallback is still used in SubmissionService if this cache misses.
    const key = txHash.toLowerCase();
    this.eventsByTxHash.set(key, events);
  }

  registerByExpectedRoot(expectedRoot: string, events: GatewayEvent[]): void {
    if (!expectedRoot) return;
    this.eventsByExpectedRoot.set(expectedRoot.toLowerCase(), events);
  }

  take(txHash: string): GatewayEvent[] | undefined {
    const key = txHash.toLowerCase();
    const events = this.eventsByTxHash.get(key);
    if (events) {
      this.eventsByTxHash.delete(key);
    }
    return events;
  }

  takeByExpectedRoot(expectedRoot: string): GatewayEvent[] | undefined {
    const key = expectedRoot.toLowerCase();
    const events = this.eventsByExpectedRoot.get(key);
    if (events) {
      this.eventsByExpectedRoot.delete(key);
    }
    return events;
  }
}
