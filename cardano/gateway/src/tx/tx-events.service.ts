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

  register(txHash: string, events: GatewayEvent[]): void {
    if (!txHash) return;
    // Cardano transaction ids hash the body, so adding witnesses to the
    // unsigned transaction does not change this key.
    const key = txHash.toLowerCase();
    this.eventsByTxHash.set(key, events);
  }

  take(txHash: string): GatewayEvent[] | undefined {
    const key = txHash.toLowerCase();
    const events = this.eventsByTxHash.get(key);
    if (events) {
      this.eventsByTxHash.delete(key);
    }
    return events;
  }
}
