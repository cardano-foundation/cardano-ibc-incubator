import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { convertString2Hex, hashSHA256, hashSha3_256 } from '@shared/helpers/hex';
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
    findAll: jest.Mock;
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
      findAll: jest.fn(),
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

  it('resolves ibc/<hash> to canonical path/base_denom for burn', async () => {
    const fullDenomPath = 'transfer/channel-0/stake';
    const hash = hashSHA256(convertString2Hex(fullDenomPath)).toUpperCase();
    denomTraceServiceMock.findAll.mockResolvedValue([{ path: 'transfer/channel-0', base_denom: 'stake' }]);

    await expect((service as any)._resolveVoucherDenomForBurn(`ibc/${hash}`)).resolves.toBe(fullDenomPath);
  });

  it('fails burn resolution when ibc/<hash> has no trace mapping', async () => {
    denomTraceServiceMock.findAll.mockResolvedValue([]);

    await expect((service as any)._resolveVoucherDenomForBurn('ibc/ABCDEF')).rejects.toThrow(
      GrpcInvalidArgumentException,
    );
  });

  it('rejects voucher token-name hashing when denom appears hex-encoded', () => {
    expect(() => (service as any)._buildVoucherTokenName('0123abcd')).toThrow(GrpcInvalidArgumentException);
  });

  it('hashes voucher token-name from canonical non-hex denom', () => {
    const canonicalDenom = 'transfer/channel-0/stake';
    const tokenName = (service as any)._buildVoucherTokenName(canonicalDenom);

    expect(tokenName).toBe(hashSha3_256(convertString2Hex(canonicalDenom)));
  });

  it('produces the same voucher token-name after ibc hash reverse lookup round-trip', async () => {
    const canonicalDenom = 'transfer/channel-0/stake';
    const ibcHash = hashSHA256(convertString2Hex(canonicalDenom)).toLowerCase();
    denomTraceServiceMock.findAll.mockResolvedValue([{ path: 'transfer/channel-0', base_denom: 'stake' }]);

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
});
