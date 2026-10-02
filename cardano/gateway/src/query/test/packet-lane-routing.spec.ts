import { createHash } from 'node:crypto';
import { PacketService } from '../services/packet.service';

describe('default transfer packet queries', () => {
  const request = { port_id: 'transfer', channel_id: 'channel-0', sequence: 3n };
  const height = { revision_number: 0n, revision_height: 42n };
  const encodedProof = Buffer.from([1, 2, 3]);
  const ack = Buffer.from('{"result":"AQ=="}');
  const proof = jest.fn();
  const entries = jest.fn();
  const service = new PacketService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { proof, entries } as any,
  );
  beforeEach(() => jest.clearAllMocks());

  it('returns the raw packet commitment and lane proof at the requested height', async () => {
    proof.mockResolvedValue({ value: 'ab'.repeat(32), proof: encodedProof, proof_height: height });
    await expect(service.queryPacketCommitment(request, { queryHeight: 42n })).resolves.toEqual({
      commitment: Buffer.from('ab'.repeat(32), 'hex'),
      proof: encodedProof,
      proof_height: height,
    });
    expect(proof).toHaveBeenCalledWith('transfer', 'channel-0', 3n, 'commitments', 42n);
  });

  it('returns the acknowledgement preimage while proving its lane commitment', async () => {
    proof.mockResolvedValue({
      value: createHash('sha256').update(ack).digest('hex'),
      proof: encodedProof,
      proof_height: height,
    });
    await expect(service.queryPacketAcknowledgement(request, { queryHeight: 42n })).resolves.toEqual({
      acknowledgement: ack,
      proof: encodedProof,
      proof_height: height,
    });
    expect(proof).toHaveBeenCalledWith('transfer', 'channel-0', 3n, 'acks', 42n);
  });

  it('uses a receipt absence proof without reading legacy channel state', async () => {
    proof.mockResolvedValue({ value: undefined, proof: encodedProof, proof_height: height });
    await expect(service.queryPacketReceipt(request, { queryHeight: 42n })).resolves.toEqual({
      received: false,
      proof: encodedProof,
      proof_height: height,
    });
    expect(proof).toHaveBeenCalledWith('transfer', 'channel-0', 3n, 'receipts', 42n);
  });
});
