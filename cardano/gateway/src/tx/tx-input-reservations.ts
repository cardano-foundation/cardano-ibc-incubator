import type { UTxO } from '@lucid-evolution/lucid';

const key = (input: Pick<UTxO, 'txHash' | 'outputIndex'>) => `${input.txHash}#${input.outputIndex}`;

export class PacketInputsBusyError extends Error {}

/** In-process coordination. Canonical spends and ledger validity bounds release leases. */
export class TxInputReservations {
  private readonly leases = new Map<string, { inputs: UTxO[]; expiresAt: number }>();

  get pending() {
    return this.leases.size > 0;
  }

  async refresh(now: number, unspent: (inputs: UTxO[]) => Promise<UTxO[]>) {
    for (const [hash, lease] of this.leases) if (lease.expiresAt <= now) this.leases.delete(hash);
    if (!this.leases.size) return;
    const inputs = [...this.leases.values()].flatMap((lease) => lease.inputs);
    const live = new Set((await unspent(inputs)).map(key));
    // Once any spending input is consumed, the unsigned transaction cannot be
    // submitted again. Release its fee/collateral pool for the next operation.
    for (const [hash, lease] of this.leases) {
      if (lease.inputs.some((input) => !live.has(key(input)))) this.leases.delete(hash);
    }
  }

  available(inputs: UTxO[]): UTxO[] {
    const reserved = new Set([...this.leases.values()].flatMap((lease) => lease.inputs.map(key)));
    return inputs.filter((input) => !reserved.has(key(input)));
  }

  assertAvailable(inputs: UTxO[]) {
    if (this.available(inputs).length !== inputs.length) {
      throw new PacketInputsBusyError(
        'Packet inputs are reserved by an outstanding transaction. Retry after inclusion or expiry',
      );
    }
  }

  reserve(hash: string, inputs: UTxO[], expiresAt: number) {
    this.assertAvailable(inputs);
    this.leases.set(hash, { inputs, expiresAt });
  }
}
