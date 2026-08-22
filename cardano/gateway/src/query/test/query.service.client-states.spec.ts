import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientState } from '@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { decodeClientDatum } from '@shared/types/client-datum';
import { normalizeClientStateFromDatum } from '@shared/helpers/client-state';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { HistoryService } from '../services/history.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { DenomTraceService } from '../services/denom-trace.service';
import { QueryService } from '../services/query.service';
import { CLIENT_PREFIX } from '../../constant';
import { GrpcInternalException } from '../../exception/grpc_exceptions';

jest.mock('@shared/types/client-datum', () => ({
  decodeClientDatum: jest.fn(),
}));

jest.mock('@shared/helpers/client-state', () => ({
  normalizeClientStateFromDatum: jest.fn(),
}));

describe('QueryService live client state listings', () => {
  const CLIENT_POLICY_ID = 'a'.repeat(56);
  const CLIENT_ADDRESS = 'addr_test1client';
  const CLIENT_TOKEN_PREFIX = 'b'.repeat(48);
  const HOST_STATE_NFT = {
    policyId: 'c'.repeat(56),
    name: 'd'.repeat(32),
  };

  let service: QueryService;
  let lucidService: {
    LucidImporter: object;
    generateTokenName: jest.Mock;
    findUtxoAtHostStateNFT: jest.Mock;
    findUtxoByUnit: jest.Mock;
    getClientAuthTokenUnit: jest.Mock;
  };
  let kupoService: {
    queryUtxosAtAddressByPolicyAndTokenPrefix: jest.Mock;
  };

  const tokenNameFor = (clientId: string | bigint): string =>
    CLIENT_TOKEN_PREFIX + Buffer.from(clientId.toString(), 'utf8').toString('hex');

  const clientUtxo = (clientId: string | bigint, suffix = '') => ({
    txHash: `tx-${clientId}${suffix}`,
    outputIndex: 0,
    datum: `datum-${clientId}${suffix}`,
    matchedTokenNames: [tokenNameFor(clientId)],
  });

  const clientIds = (response: Awaited<ReturnType<QueryService['queryClientStates']>>): string[] =>
    response.client_states.map((clientState) => clientState.client_id);

  beforeEach(() => {
    jest.clearAllMocks();

    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    const configService = {
      get: jest.fn((key: string) => {
        if (key !== 'deployment') return undefined;
        return {
          hostStateNFT: HOST_STATE_NFT,
          validators: {
            mintClientStt: { scriptHash: CLIENT_POLICY_ID },
            spendClient: { address: CLIENT_ADDRESS },
          },
        };
      }),
    } as unknown as ConfigService;

    lucidService = {
      LucidImporter: {},
      generateTokenName: jest.fn((_baseToken, _prefix, sequence: bigint) => tokenNameFor(sequence)),
      findUtxoAtHostStateNFT: jest.fn(),
      findUtxoByUnit: jest.fn(),
      getClientAuthTokenUnit: jest.fn(),
    };
    kupoService = {
      queryUtxosAtAddressByPolicyAndTokenPrefix: jest.fn().mockResolvedValue([]),
    };

    (decodeClientDatum as jest.Mock).mockImplementation(async (datum: string) => ({
      state: { clientState: { datum } },
    }));
    (normalizeClientStateFromDatum as jest.Mock).mockImplementation((state: { datum: string }) =>
      ClientState.fromPartial({ chain_id: state.datum }),
    );

    service = new QueryService(
      logger,
      configService,
      lucidService as unknown as LucidService,
      kupoService as unknown as KupoService,
      {} as HistoryService,
      {} as MiniProtocalsService,
      {} as MithrilService,
      {} as DenomTraceService,
      {} as any,
    );
  });

  it('discovers sparse live IDs once and returns them in numeric order', async () => {
    kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix.mockResolvedValue([
      clientUtxo(99n),
      clientUtxo(2n),
      clientUtxo(12n),
    ]);

    const response = await service.queryClientStates({});

    expect(clientIds(response)).toEqual(['07-tendermint-2', '07-tendermint-12', '07-tendermint-99']);
    expect(response.pagination).toEqual({ next_key: new Uint8Array(), total: 0n });
    expect(kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix).toHaveBeenCalledTimes(1);
    expect(kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix).toHaveBeenCalledWith(
      CLIENT_ADDRESS,
      CLIENT_POLICY_ID,
      CLIENT_TOKEN_PREFIX,
    );
    expect(lucidService.generateTokenName).toHaveBeenCalledWith(HOST_STATE_NFT, CLIENT_PREFIX, 0n);
    expect(decodeClientDatum).toHaveBeenCalledTimes(3);
    expect((decodeClientDatum as jest.Mock).mock.calls.map(([datum]) => datum)).toEqual([
      'datum-2',
      'datum-12',
      'datum-99',
    ]);
    expect(lucidService.findUtxoAtHostStateNFT).not.toHaveBeenCalled();
    expect(lucidService.findUtxoByUnit).not.toHaveBeenCalled();
    expect(lucidService.getClientAuthTokenUnit).not.toHaveBeenCalled();
  });

  it('filters malformed, non-canonical, and wrong-prefix token names before decoding', async () => {
    kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix.mockResolvedValue([
      clientUtxo(7n),
      { ...clientUtxo('wrong'), matchedTokenNames: ['e'.repeat(48) + Buffer.from('8').toString('hex')] },
      { ...clientUtxo('embedded'), matchedTokenNames: ['00' + CLIENT_TOKEN_PREFIX + Buffer.from('9').toString('hex')] },
      { ...clientUtxo('odd'), matchedTokenNames: [CLIENT_TOKEN_PREFIX + '3'] },
      { ...clientUtxo('text'), matchedTokenNames: [CLIENT_TOKEN_PREFIX + Buffer.from('abc').toString('hex')] },
      { ...clientUtxo('leading-zero'), matchedTokenNames: [CLIENT_TOKEN_PREFIX + Buffer.from('01').toString('hex')] },
      {
        ...clientUtxo('too-long'),
        matchedTokenNames: [CLIENT_TOKEN_PREFIX + Buffer.from('123456789').toString('hex')],
      },
    ]);

    const response = await service.queryClientStates({});

    expect(clientIds(response)).toEqual(['07-tendermint-7']);
    expect(decodeClientDatum).toHaveBeenCalledTimes(1);
    expect(decodeClientDatum).toHaveBeenCalledWith('datum-7', lucidService.LucidImporter);
  });

  it('rejects duplicate live UTxOs for the same client ID', async () => {
    kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix.mockResolvedValue([
      clientUtxo(4n, '-first'),
      clientUtxo(4n, '-second'),
    ]);

    await expect(service.queryClientStates({})).rejects.toBeInstanceOf(GrpcInternalException);
    expect(decodeClientDatum).not.toHaveBeenCalled();
  });

  it('rejects a live UTxO carrying multiple client authentication tokens', async () => {
    kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix.mockResolvedValue([
      {
        ...clientUtxo(4n),
        matchedTokenNames: [tokenNameFor(4n), tokenNameFor(5n)],
      },
    ]);

    await expect(service.queryClientStates({})).rejects.toBeInstanceOf(GrpcInternalException);
    expect(decodeClientDatum).not.toHaveBeenCalled();
  });

  it('applies offset pagination after numeric ordering and emits a reusable next key', async () => {
    kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix.mockResolvedValue([
      clientUtxo(20n),
      clientUtxo(2n),
      clientUtxo(10n),
      clientUtxo(1n),
    ]);

    const firstPage = await service.queryClientStates({
      pagination: {
        key: new Uint8Array(),
        offset: 1n,
        limit: 2n,
        count_total: true,
        reverse: false,
      },
    });

    expect(clientIds(firstPage)).toEqual(['07-tendermint-2', '07-tendermint-10']);
    expect(firstPage.pagination?.total).toBe(4n);
    expect(firstPage.pagination?.next_key).toEqual(Buffer.from(JSON.stringify({ offset: 3 })));

    const secondPage = await service.queryClientStates({
      pagination: {
        key: firstPage.pagination!.next_key,
        offset: 999n,
        limit: 2n,
        count_total: true,
        reverse: false,
      },
    });

    expect(clientIds(secondPage)).toEqual(['07-tendermint-20']);
    expect(secondPage.pagination).toEqual({ next_key: new Uint8Array(), total: 0n });
  });

  it('honors reverse and nonzero offsets even when the page limit exceeds the live count', async () => {
    kupoService.queryUtxosAtAddressByPolicyAndTokenPrefix.mockResolvedValue([
      clientUtxo(20n),
      clientUtxo(2n),
      clientUtxo(10n),
      clientUtxo(1n),
    ]);

    const response = await service.queryClientStates({
      pagination: {
        key: new Uint8Array(),
        offset: 1n,
        limit: 100n,
        count_total: false,
        reverse: true,
      },
    });

    expect(clientIds(response)).toEqual(['07-tendermint-10', '07-tendermint-2', '07-tendermint-1']);
    expect(response.pagination).toEqual({ next_key: new Uint8Array(), total: 0n });
  });
});
