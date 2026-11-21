import { Metadata } from '@grpc/grpc-js';
import { getIncludeProofFromMetadata } from '../helpers/query-height';

describe('state-only query metadata', () => {
  it('defaults to proofs and accepts an explicit opt-out', () => {
    expect(getIncludeProofFromMetadata()).toBe(true);
    const metadata = new Metadata();
    metadata.set('x-cardano-include-proof', 'false');
    expect(getIncludeProofFromMetadata(metadata)).toBe(false);
    metadata.set('x-cardano-include-proof', 'true');
    expect(getIncludeProofFromMetadata(metadata)).toBe(true);
  });
  it('rejects ambiguous or malformed flags', () => {
    const metadata = new Metadata();
    metadata.set('x-cardano-include-proof', '0');
    expect(() => getIncludeProofFromMetadata(metadata)).toThrow();
    metadata.set('x-cardano-include-proof', 'false');
    metadata.add('x-cardano-include-proof', 'true');
    expect(() => getIncludeProofFromMetadata(metadata)).toThrow();
  });
});
