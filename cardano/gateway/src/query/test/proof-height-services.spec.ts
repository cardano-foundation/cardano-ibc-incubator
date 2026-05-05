import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientState, ConsensusState } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { DenomTraceService } from '../services/denom-trace.service';
import { ChannelService } from '../services/channel.service';
import { PacketService } from '../services/packet.service';
import { QueryService } from '../services/query.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { HistoryService } from '../services/history.service';
import { decodeChannelDatum } from '../../shared/types/channel/channel-datum';
import { decodeClientDatum } from '@shared/types/client-datum';
import { normalizeClientStateFromDatum } from '@shared/helpers/client-state';
import { normalizeConsensusStateFromDatum } from '@shared/helpers/consensus-state';
import { getCurrentTree } from '../../shared/helpers/ibc-state-root';

jest.mock('../../shared/types/channel/channel-datum', () => ({
  decodeChannelDatum: jest.fn(),
}));

jest.mock('@shared/types/client-datum', () => ({
  decodeClientDatum: jest.fn(),
}));

jest.mock('@shared/helpers/client-state', () => ({
  normalizeClientStateFromDatum: jest.fn(),
}));

jest.mock('@shared/helpers/consensus-state', () => ({
  normalizeConsensusStateFromDatum: jest.fn(),
}));

jest.mock('../../shared/helpers/ics23-proof-serialization', () => ({
  serializeExistenceProof: jest.fn(() => Buffer.from('existence-proof')),
  serializeNonExistenceProof: jest.fn(() => Buffer.from('non-existence-proof')),
}));

jest.mock('../../shared/helpers/ibc-state-root', () => ({
  getCurrentTree: jest.fn(() => ({
    generateProof: jest.fn(),
    generateNonExistenceProof: jest.fn(),
  })),
  isTreeAligned: jest.fn(() => true),
  alignTreeWithChain: jest.fn(async () => ({ root: 'aligned-root' })),
}));

const HISTORICAL_HEIGHT = 123n;
const LATEST_ACCEPTED_HEIGHT = 200n;
const HISTORICAL_ROOT = 'ab'.repeat(32);
const CHANNEL_TOKEN_UNIT = 'policychannel-token';
const CLIENT_TOKEN_UNIT = 'client-auth-token-unit';

function toHex(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex');
}

function makeLogger(): Logger {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeChannelDatum(overrides: Record<string, unknown> = {}) {
  return {
    port: toHex('transfer'),
    state: {
      channel: {
        state: 'Open',
        ordering: 'Unordered',
        counterparty: {
          port_id: toHex('transfer'),
          channel_id: toHex('channel-7'),
        },
        connection_hops: [toHex('connection-0')],
        version: toHex('ics20-1'),
      },
      next_sequence_send: 9n,
      next_sequence_recv: 10n,
      next_sequence_ack: 8n,
      packet_commitment: new Map([[7n, 'commitment-bytes']]),
      packet_receipt: new Map([[7n, 'AQ==']]),
      packet_acknowledgement: new Map([[7n, 'AQ==']]),
      ...overrides,
    },
    token: {
      policyId: 'policy',
      name: 'name',
    },
  };
}

function makeHistoricalTree() {
  return {
    generateProof: jest.fn((path: string) => ({ path })),
    generateNonExistenceProof: jest.fn((path: string) => ({ path })),
  };
}

function makeDeps() {
  const historicalTree = makeHistoricalTree();
  const logger = makeLogger();
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'cardanoLightClientMode') return 'mithril';
      if (key === 'cardanoChainId') return 'cardano-devnet';
      return undefined;
    }),
  } as unknown as ConfigService;
  const lucidService = {
    LucidImporter: {},
    decodeDatum: jest.fn(async (_datum: string, schema: string) => {
      if (schema === 'host_state') {
        return {
          state: {
            ibc_state_root: HISTORICAL_ROOT,
          },
        };
      }
      if (schema === 'channel') {
        return makeChannelDatum();
      }
      return {};
    }),
    findUtxoAtHostStateNFT: jest.fn(async () => ({
      txHash: 'live-host-state-tx',
      outputIndex: 0,
      datum: 'live-host-state-datum',
    })),
    findUtxoByUnit: jest.fn(async () => ({
      txHash: 'live-utxo',
      outputIndex: 0,
      datum: 'live-datum',
    })),
    getChannelTokenUnit: jest.fn(() => ['policy', 'channel-token']),
    getClientAuthTokenUnit: jest.fn(() => CLIENT_TOKEN_UNIT),
  };
  const historyService = {
    findHostStateUtxoAtOrBeforeBlockNo: jest.fn(async (height: bigint) => ({
      txHash: height === LATEST_ACCEPTED_HEIGHT ? 'live-host-state-tx' : 'historical-host-state-tx',
      outputIndex: 0,
      datum: 'historical-host-state-datum',
    })),
    findUtxoByUnitAtOrBeforeBlockNo: jest.fn(async () => ({
      txHash: 'historical-utxo',
      outputIndex: 0,
      datum: 'historical-datum',
    })),
  };
  const mithrilService = {
    getCardanoTransactionsSetSnapshot: jest.fn(async () => [
      {
        block_number: LATEST_ACCEPTED_HEIGHT.toString(),
      },
    ]),
  };
  const ibcTreeCacheService = {
    load: jest.fn(async () => ({
      root: HISTORICAL_ROOT,
      tree: historicalTree,
    })),
  };

  return {
    historicalTree,
    logger,
    configService,
    lucidService: lucidService as unknown as LucidService,
    historyService: historyService as unknown as HistoryService,
    mithrilService: mithrilService as unknown as MithrilService,
    ibcTreeCacheService,
    mocks: {
      lucidService,
      historyService,
      mithrilService,
      ibcTreeCacheService,
    },
  };
}

describe('proof-bearing services with historical query heights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (decodeChannelDatum as jest.Mock).mockResolvedValue(makeChannelDatum());
    (decodeClientDatum as jest.Mock).mockResolvedValue({
      state: {
        clientState: {
          latestHeight: {
            revisionHeight: 77n,
          },
        },
        consensusStates: new Map(),
      },
    });
    (normalizeClientStateFromDatum as jest.Mock).mockReturnValue(
      ClientState.fromPartial({
        chain_id: 'counterparty',
        latest_height: {
          revision_number: 0n,
          revision_height: 77n,
        },
      }),
    );
    (normalizeConsensusStateFromDatum as jest.Mock).mockReturnValue(
      ConsensusState.fromPartial({
        timestamp: {
          seconds: 1n,
          nanos: 0,
        },
        root: {
          hash: new Uint8Array([1]),
        },
        next_validators_hash: new Uint8Array([2]),
      }),
    );
  });

  it('serves channel proofs from the cached tree at the requested height', async () => {
    const deps = makeDeps();
    const service = new ChannelService(
      deps.logger,
      deps.configService,
      deps.lucidService,
      {} as KupoService,
      deps.mithrilService,
      deps.historyService,
      deps.ibcTreeCacheService as any,
    );

    const response = await service.queryChannel({ channel_id: 'channel-0' } as any, {
      queryHeight: HISTORICAL_HEIGHT,
    });

    expect(deps.mocks.historyService.findUtxoByUnitAtOrBeforeBlockNo).toHaveBeenCalledWith(
      CHANNEL_TOKEN_UNIT,
      HISTORICAL_HEIGHT,
    );
    expect(deps.mocks.lucidService.findUtxoByUnit).not.toHaveBeenCalled();
    expect(deps.historicalTree.generateProof).toHaveBeenCalledWith('channelEnds/ports/transfer/channels/channel-0');
    expect(getCurrentTree).not.toHaveBeenCalled();
    expect(response.proof_height?.revision_height).toBe(HISTORICAL_HEIGHT);
  });

  it('serves packet commitment proofs from the cached tree at the requested height', async () => {
    const deps = makeDeps();
    const service = new PacketService(
      deps.logger,
      deps.configService,
      deps.lucidService,
      deps.mithrilService,
      deps.historyService,
      deps.ibcTreeCacheService as any,
    );

    const response = await service.queryPacketCommitment(
      { channel_id: 'channel-0', port_id: 'transfer', sequence: 7n } as any,
      { queryHeight: HISTORICAL_HEIGHT },
    );

    expect(deps.mocks.historyService.findUtxoByUnitAtOrBeforeBlockNo).toHaveBeenCalledWith(
      CHANNEL_TOKEN_UNIT,
      HISTORICAL_HEIGHT,
    );
    expect(deps.historicalTree.generateProof).toHaveBeenCalledWith(
      'commitments/ports/transfer/channels/channel-0/sequences/7',
    );
    expect(getCurrentTree).not.toHaveBeenCalled();
    expect(response.commitment).toBe('commitment-bytes');
    expect(response.proof_height?.revision_height).toBe(HISTORICAL_HEIGHT);
  });

  it('serves packet receipt non-existence proofs from the cached tree at the requested height', async () => {
    const deps = makeDeps();
    (decodeChannelDatum as jest.Mock).mockResolvedValueOnce(makeChannelDatum({ packet_receipt: new Map() }));
    const service = new PacketService(
      deps.logger,
      deps.configService,
      deps.lucidService,
      deps.mithrilService,
      deps.historyService,
      deps.ibcTreeCacheService as any,
    );

    const response = await service.queryPacketReceipt(
      { channel_id: 'channel-0', port_id: 'transfer', sequence: 8n } as any,
      { queryHeight: HISTORICAL_HEIGHT },
    );

    expect(deps.historicalTree.generateNonExistenceProof).toHaveBeenCalledWith(
      'receipts/ports/transfer/channels/channel-0/sequences/8',
    );
    expect(response.received).toBe(false);
    expect(response.proof_height?.revision_height).toBe(HISTORICAL_HEIGHT);
  });

  it('serves next sequence receive proofs from the cached tree at the requested height', async () => {
    const deps = makeDeps();
    const service = new PacketService(
      deps.logger,
      deps.configService,
      deps.lucidService,
      deps.mithrilService,
      deps.historyService,
      deps.ibcTreeCacheService as any,
    );

    const response = await service.queryNextSequenceReceive(
      { channel_id: 'channel-0', port_id: 'transfer' } as any,
      { queryHeight: HISTORICAL_HEIGHT },
    );

    expect(deps.historicalTree.generateProof).toHaveBeenCalledWith(
      'nextSequenceRecv/ports/transfer/channels/channel-0',
    );
    expect(response.next_sequence_receive).toBe('10');
    expect(response.proof_height?.revision_height).toBe(HISTORICAL_HEIGHT);
  });

  it('serves client state proofs from the cached tree at the requested height', async () => {
    const deps = makeDeps();
    const service = new QueryService(
      deps.logger,
      deps.configService,
      deps.lucidService,
      {} as KupoService,
      deps.historyService,
      {} as MiniProtocalsService,
      deps.mithrilService,
      {} as DenomTraceService,
      deps.ibcTreeCacheService as any,
    );

    const response = await service.queryClientState({ client_id: '07-tendermint-0' } as any, {
      queryHeight: HISTORICAL_HEIGHT,
    });

    expect(deps.mocks.historyService.findUtxoByUnitAtOrBeforeBlockNo).toHaveBeenCalledWith(
      CLIENT_TOKEN_UNIT,
      HISTORICAL_HEIGHT,
    );
    expect(deps.historicalTree.generateProof).toHaveBeenCalledWith('clients/07-tendermint-0/clientState');
    expect(response.proof_height?.revision_height).toBe(HISTORICAL_HEIGHT);
  });

  it('serves consensus state proofs from the cached tree at the requested height', async () => {
    const deps = makeDeps();
    const service = new QueryService(
      deps.logger,
      deps.configService,
      deps.lucidService,
      {} as KupoService,
      deps.historyService,
      {} as MiniProtocalsService,
      deps.mithrilService,
      {} as DenomTraceService,
      deps.ibcTreeCacheService as any,
    );

    const response = await service.queryConsensusState(
      {
        client_id: '07-tendermint-0',
        revision_number: 0n,
        revision_height: 77n,
        latest_height: false,
      } as any,
      { queryHeight: HISTORICAL_HEIGHT },
    );

    expect(normalizeConsensusStateFromDatum).toHaveBeenCalledWith(expect.any(Map), 77n);
    expect(deps.historicalTree.generateProof).toHaveBeenCalledWith('clients/07-tendermint-0/consensusStates/77');
    expect(response.proof_height?.revision_height).toBe(HISTORICAL_HEIGHT);
  });
});
