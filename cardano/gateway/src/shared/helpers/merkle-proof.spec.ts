import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';

import { initializeMerkleProof, initializeNonExistProof } from './merkle-proof';

const emptyExistenceProof = {
  key: '',
  value: '',
  leaf: {
    hash: 0n,
    prehash_key: 0n,
    prehash_value: 0n,
    length: 0n,
    prefix: '',
  },
  path: [],
};

const neighborProof = {
  key: Uint8Array.from([1]),
  value: Uint8Array.from([2]),
  path: [],
};

describe('initializeMerkleProof', () => {
  it('rejects a commitment proof without a supported variant', () => {
    expect(() => initializeMerkleProof({ proofs: [{}] })).toThrow(GrpcInvalidArgumentException);
  });
});

describe('initializeNonExistProof', () => {
  it('preserves a left-only neighbor proof', () => {
    expect(
      initializeNonExistProof({
        key: Uint8Array.from([3]),
        left: neighborProof,
      }),
    ).toEqual({
      key: '03',
      left: {
        ...emptyExistenceProof,
        key: '01',
        value: '02',
      },
      right: emptyExistenceProof,
    });
  });

  it('preserves a right-only neighbor proof', () => {
    expect(
      initializeNonExistProof({
        key: Uint8Array.from([3]),
        right: neighborProof,
      }),
    ).toEqual({
      key: '03',
      left: emptyExistenceProof,
      right: {
        ...emptyExistenceProof,
        key: '01',
        value: '02',
      },
    });
  });
});
