import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { convertString2Hex, hashSHA256, hashSha3_256 } from '@shared/helpers/hex';
import { insertSortMapWithNumberKey, prependToMap } from '@shared/helpers/helper';
import { PacketService } from '../packet.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { DenomTraceService } from '../../query/services/denom-trace.service';
import { IbcTreePendingUpdatesService } from '../../shared/services/ibc-tree-pending-updates.service';

describe('PacketService denom invariants', () => {
  let service: PacketService;
  let lucidServiceMock: {
    getPaymentCredential: jest.Mock;
    credentialToAddress: jest.Mock;
  };
  let denomTraceServiceMock: {
    findByIbcDenomHash: jest.Mock;
  };

  beforeEach(() => {
    const loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    const configServiceMock = {
      get: jest.fn(),
    } as unknown as ConfigService;

    lucidServiceMock = {
      getPaymentCredential: jest.fn(),
      credentialToAddress: jest.fn(),
    };

    denomTraceServiceMock = {
      findByIbcDenomHash: jest.fn(),
    };

    service = new PacketService(
      loggerMock,
      configServiceMock,
      lucidServiceMock as unknown as LucidService,
      denomTraceServiceMock as unknown as DenomTraceService,
      {} as IbcTreePendingUpdatesService,
    );
  });

  it('keeps voucher-prefixed denom unchanged', () => {
    const denom = 'transfer/channel-0/stake';
    const normalized = (service as any)._normalizePacketDenom(denom, 'transfer', 'channel-0');

    expect(normalized).toBe(denom);
  });

  it('hex-encodes plain denoms exactly once', () => {
    const denom = 'stake';
    const normalized = (service as any)._normalizePacketDenom(denom, 'transfer', 'channel-0');

    expect(normalized).toBe(convertString2Hex(denom));
  });

  it('rejects already-hex denoms in packet normalization', () => {
    expect(() => (service as any)._normalizePacketDenom('deadbeef', 'transfer', 'channel-0')).toThrow(
      GrpcInvalidArgumentException,
    );
  });

  it('rejects unresolved ibc/<hash> denoms in packet normalization', () => {
    expect(() => (service as any)._normalizePacketDenom('ibc/ABCDEF', 'transfer', 'channel-0')).toThrow(
      GrpcInvalidArgumentException,
    );
  });

  it('keeps Cardano token-unit denoms unchanged', () => {
    const tokenUnit = '465209195f27c99dfefdcb725e939ad3262339a9b150992b66673be86d6f636b';
    const normalized = (service as any)._normalizePacketDenom(tokenUnit, 'transfer', 'channel-0');

    expect(normalized).toBe(tokenUnit);
  });

  it('unwraps voucher-prefixed denom to base denom for unescrow', () => {
    const unwrapped = (service as any)._unwrapVoucherDenom('transfer/channel-0/stake', 'transfer', 'channel-0');

    expect(unwrapped).toBe('stake');
  });

  it('rejects malformed voucher denom with missing base denom', () => {
    expect(() => (service as any)._unwrapVoucherDenom('transfer/channel-0/', 'transfer', 'channel-0')).toThrow(
      GrpcInvalidArgumentException,
    );
  });

  it('resolves transfer-module asset unit case-insensitively', () => {
    const assets = {
      '465209195F27C99DFEFDCB725E939AD3262339A9B150992B66673BE86D6F636B': 40_000_000n,
    };
    const resolved = (service as any)._resolveAssetUnitFromUtxoAssets(
      assets,
      '465209195f27c99dfefdcb725e939ad3262339a9b150992b66673be86d6f636b',
    );

    expect(resolved).toBe('465209195F27C99DFEFDCB725E939AD3262339A9B150992B66673BE86D6F636B');
  });

  it('rejects transfer-module denom units missing from UTxO assets', () => {
    const assets = {
      lovelace: 1_500_000n,
    };

    expect(() =>
      (service as any)._resolveAssetUnitFromUtxoAssets(
        assets,
        '465209195f27c99dfefdcb725e939ad3262339a9b150992b66673be86d6f636b',
      ),
    ).toThrow(GrpcInvalidArgumentException);
  });

  it('does not fall back from escrow denom to voucher token units', () => {
    const inputDenom = 'def68337867cb4f1f95b6b811fedbfcdd7780d10a95cc072077088ea6d6f636b';
    const resolvedDenom = inputDenom;
    const unrelatedVoucherTokenUnit = `voucherpolicy${hashSha3_256(convertString2Hex('transfer/channel-0/stake'))}`;
    const senderWalletUtxos = [
      {
        assets: {
          lovelace: 2_000_000n,
          [unrelatedVoucherTokenUnit]: 10n,
        },
      },
    ];

    expect(() =>
      (service as any)._resolveEscrowDenomToken(inputDenom, resolvedDenom, senderWalletUtxos),
    ).toThrow(GrpcInvalidArgumentException);
  });

  it('resolves ibc/<hash> to canonical path/base_denom for burn', async () => {
    const fullDenomPath = 'transfer/channel-0/stake';
    const hash = hashSHA256(convertString2Hex(fullDenomPath)).toUpperCase();
    denomTraceServiceMock.findByIbcDenomHash.mockResolvedValue({ path: 'transfer/channel-0', base_denom: 'stake' });

    await expect((service as any)._resolveVoucherDenomForBurn(`ibc/${hash}`)).resolves.toBe(fullDenomPath);
  });

  it('resolves ibc/<hash> to canonical path/base_denom for send-path denom handling', async () => {
    const fullDenomPath = 'transfer/channel-0/stake';
    const hash = hashSHA256(convertString2Hex(fullDenomPath)).toUpperCase();
    denomTraceServiceMock.findByIbcDenomHash.mockResolvedValue({ path: 'transfer/channel-0', base_denom: 'stake' });

    await expect((service as any)._resolvePacketDenomForSend(`ibc/${hash}`)).resolves.toBe(fullDenomPath);
  });

  it('fails burn resolution when ibc/<hash> has no trace mapping', async () => {
    denomTraceServiceMock.findByIbcDenomHash.mockResolvedValue(null);

    await expect((service as any)._resolveVoucherDenomForBurn('ibc/ABCDEF')).rejects.toThrow(
      GrpcInvalidArgumentException,
    );
  });

  it('rejects voucher token-name hashing when denom appears hex-encoded', () => {
    expect(() => (service as any)._buildVoucherTokenName('0123abcd')).toThrow(GrpcInvalidArgumentException);
  });

  it('rejects voucher token-name hashing when denom is unresolved ibc/<hash>', () => {
    expect(() => (service as any)._buildVoucherTokenName('ibc/ABCDEF')).toThrow(GrpcInvalidArgumentException);
  });

  it('hashes voucher token-name from canonical non-hex denom', () => {
    const canonicalDenom = 'transfer/channel-0/stake';
    const tokenName = (service as any)._buildVoucherTokenName(canonicalDenom);

    expect(tokenName).toBe(hashSha3_256(convertString2Hex(canonicalDenom)));
  });

  it('does not apply an extra prefix when hashing refund voucher denoms', () => {
    const canonicalDenom = 'transfer/channel-0/transfer/channel-1/stake';
    const doublePrefixedDenom = `transfer/channel-0/${canonicalDenom}`;
    const tokenName = (service as any)._buildVoucherTokenName(canonicalDenom);

    expect(tokenName).toBe(hashSha3_256(convertString2Hex(canonicalDenom)));
    expect(tokenName).not.toBe(hashSha3_256(convertString2Hex(doublePrefixedDenom)));
  });

  it('produces the same voucher token-name after ibc hash reverse lookup round-trip', async () => {
    const canonicalDenom = 'transfer/channel-0/stake';
    const ibcHash = hashSHA256(convertString2Hex(canonicalDenom)).toLowerCase();
    denomTraceServiceMock.findByIbcDenomHash.mockResolvedValue({ path: 'transfer/channel-0', base_denom: 'stake' });

    const resolvedDenom = await (service as any)._resolveVoucherDenomForBurn(`ibc/${ibcHash}`);
    const tokenNameFromResolved = (service as any)._buildVoucherTokenName(resolvedDenom);
    const tokenNameFromCanonical = (service as any)._buildVoucherTokenName(canonicalDenom);

    expect(resolvedDenom).toBe(canonicalDenom);
    expect(tokenNameFromResolved).toBe(tokenNameFromCanonical);
  });

  it('rejects script voucher receivers and allows key receivers', () => {
    const keyAddress = 'addr_test1qpkreceiver';
    lucidServiceMock.getPaymentCredential.mockReturnValue({ type: 'Key' });
    expect((service as any)._resolveVoucherReceiverAddress(keyAddress)).toBe(keyAddress);

    lucidServiceMock.getPaymentCredential.mockReturnValue({ type: 'Script' });
    expect(() => (service as any)._resolveVoucherReceiverAddress(keyAddress)).toThrow(GrpcInvalidArgumentException);
  });

  it('maps non-bech32 receiver credential into an address', () => {
    lucidServiceMock.credentialToAddress.mockReturnValue('addr_test1qmappedreceiver');

    const resolved = (service as any)._resolveVoucherReceiverAddress('payment_credential_hex');

    expect(resolved).toBe('addr_test1qmappedreceiver');
    expect(lucidServiceMock.credentialToAddress).toHaveBeenCalledWith('payment_credential_hex');
  });

  it('keeps packet acknowledgement map sorted by sequence', () => {
    const existing = new Map<bigint, string>([
      [1n, 'ack-1'],
      [3n, 'ack-3'],
    ]);

    const updated = insertSortMapWithNumberKey(new Map(existing), 2n, 'ack-2');

    expect([...updated.keys()]).toEqual([1n, 2n, 3n]);
  });

  it('does not mutate source map while sorting acknowledgement insertions', () => {
    const source = new Map<bigint, string>([
      [1n, 'ack-1'],
      [3n, 'ack-3'],
    ]);

    const updated = insertSortMapWithNumberKey(new Map(source), 2n, 'ack-2');

    expect([...source.keys()]).toEqual([1n, 3n]);
    expect([...updated.keys()]).toEqual([1n, 2n, 3n]);
  });

  it('prepends packet receipt sequence for unordered recv semantics', () => {
    const existing = new Map<bigint, string>([[1n, '']]);
    const updated = prependToMap(existing, 2n, '');

    expect([...updated.keys()]).toEqual([2n, 1n]);
  });
});
