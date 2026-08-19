import { MerkleProof } from '@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment';
import { validateAndFormatPrunePacketHistoryParams } from './packet.validate';

describe('validateAndFormatPrunePacketHistoryParams', () => {
  it('decodes the protobuf proof and normalizes bigint fields', () => {
    const neighbor = {
      key: Uint8Array.from([1]),
      value: Uint8Array.from([2]),
      leaf: {
        hash: 1,
        prehash_key: 0,
        prehash_value: 0,
        length: 1,
        prefix: Uint8Array.from([0]),
      },
      path: [],
    };
    const proofBytes = MerkleProof.encode({
      proofs: [
        {
          nonexist: {
            key: Uint8Array.from([3]),
            left: neighbor,
            right: neighbor,
          },
        },
      ],
    }).finish();

    const operator = validateAndFormatPrunePacketHistoryParams({
      signer: 'addr_test1signer',
      port_id: 'transfer',
      channel_id: 'channel-3',
      sequence: 9n,
      proof_commitment_absence: proofBytes,
      proof_height: { revision_number: 1n, revision_height: 55n },
    });

    expect(operator).toMatchObject({
      signer: 'addr_test1signer',
      portId: 'transfer',
      channelId: 'channel-3',
      sequence: 9n,
      proofHeight: { revisionNumber: 1n, revisionHeight: 55n },
    });
    expect(operator.proofCommitmentAbsence.proofs).toHaveLength(1);
  });

  it('rejects an absent proof before transaction construction', () => {
    expect(() =>
      validateAndFormatPrunePacketHistoryParams({
        signer: 'addr_test1signer',
        port_id: 'transfer',
        channel_id: 'channel-3',
        sequence: 9n,
        proof_commitment_absence: new Uint8Array(),
        proof_height: { revision_number: 0n, revision_height: 55n },
      }),
    ).toThrow('proof_commitment_absence');
  });
});
