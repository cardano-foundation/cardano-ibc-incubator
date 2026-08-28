import * as Lucid from '@lucid-evolution/lucid';

import { decodeTendermintProofRedeemer, encodeTendermintProofRedeemer } from './tendermint-proof-redeemer';

describe('Tendermint proof redeemer', () => {
  it('round-trips the exact update transition bound by the proof validator', () => {
    const redeemer = {
      Update: {
        client_input_ref: {
          transaction_id: '11'.repeat(32),
          output_index: 2n,
        },
        trusted_height: { revisionNumber: 1n, revisionHeight: 100n },
        new_height: { revisionNumber: 1n, revisionHeight: 101n },
        new_consensus_state: {
          timestamp: 1_777_896_114_886_000_000n,
          next_validators_hash: '22'.repeat(32),
          root: { hash: '33'.repeat(32) },
        },
        proof_time: 1_777_896_114_900_000_000n,
        proof: '44'.repeat(288),
      },
    };

    const encoded = encodeTendermintProofRedeemer(redeemer, Lucid);

    expect(decodeTendermintProofRedeemer(encoded, Lucid)).toEqual(redeemer);
    expect(Buffer.from(encoded, 'hex').length).toBeLessThan(450);
  });

  it('round-trips the compact two-header misbehaviour transition', () => {
    const redeemer = {
      Misbehaviour: {
        client_input_ref: {
          transaction_id: '11'.repeat(32),
          output_index: 2n,
        },
        trusted_height_1: { revisionNumber: 1n, revisionHeight: 90n },
        trusted_height_2: { revisionNumber: 1n, revisionHeight: 100n },
        proof_time: 1_777_896_114_900_000_000n,
        proof: '44'.repeat(288),
      },
    };

    const encoded = encodeTendermintProofRedeemer(redeemer, Lucid);

    expect(decodeTendermintProofRedeemer(encoded, Lucid)).toEqual(redeemer);
    expect(Buffer.from(encoded, 'hex').length).toBeLessThan(400);
    expect(encoded.startsWith('d87a')).toBe(true);
  });
});
