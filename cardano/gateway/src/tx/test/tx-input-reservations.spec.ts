import type { UTxO } from '@lucid-evolution/lucid';
import { PacketInputsBusyError, TxInputReservations } from '../tx-input-reservations';

const input = (id: number) => ({ txHash: id.toString(16).padStart(64, '0'), outputIndex: 0 }) as UTxO;

describe('packet input reservations', () => {
  it('allows disjoint lanes and excludes fees and collateral already assigned to another transaction', () => {
    const leases = new TxInputReservations();
    leases.reserve('first', [input(1), input(2), input(3)], 100);
    expect(leases.available([input(2), input(3), input(4), input(5)])).toEqual([input(4), input(5)]);
    leases.reserve('other-lane', [input(6), input(4), input(5)], 100);
    expect(() => leases.assertAvailable([input(1)])).toThrow(PacketInputsBusyError);
    expect(() => leases.reserve('double-spend', [input(2)], 100)).toThrow(PacketInputsBusyError);
  });

  it('releases a transaction pool after canonical inclusion while retaining unrelated pending transactions', async () => {
    const leases = new TxInputReservations();
    leases.reserve('first', [input(1), input(2)], 100);
    leases.reserve('second', [input(3), input(4)], 100);
    await leases.refresh(50, async () => [input(2), input(3), input(4)]);
    expect(leases.available([input(2), input(3), input(4)])).toEqual([input(2)]);
    expect(() => leases.assertAvailable([input(3)])).toThrow(PacketInputsBusyError);
  });

  it('releases abandoned unsigned transactions only at their validity deadline', async () => {
    const leases = new TxInputReservations();
    leases.reserve('abandoned', [input(1)], 100);
    await leases.refresh(99, async (inputs) => inputs);
    expect(leases.available([input(1)])).toEqual([]);
    await leases.refresh(100, async (inputs) => inputs);
    expect(leases.available([input(1)])).toEqual([input(1)]);
  });

  it('keeps reservations when canonical lookup fails', async () => {
    const leases = new TxInputReservations();
    leases.reserve('pending', [input(1)], 100);
    await expect(
      leases.refresh(50, async () => {
        throw new Error('index unavailable');
      }),
    ).rejects.toThrow('index unavailable');
    expect(leases.available([input(1)])).toEqual([]);
  });
});
