import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryService } from '../services/query.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { DenomTraceService } from '../services/denom-trace.service';
import { HistoryService } from '../services/history.service';

describe('QueryService stability anchor contract', () => {
  let service: QueryService;
  let historyServiceMock: {
    findLatestBlock: jest.Mock;
    findBlockByHeight: jest.Mock;
    findDescendantBlocks: jest.Mock;
    findEpochContextAtBlock: jest.Mock;
    findBridgeBlocks: jest.Mock;
    findHostStateUtxoAtOrBeforeBlockNo: jest.Mock;
    findTransactionEvidenceByHash: jest.Mock;
  };

  beforeEach(() => {
    process.env.CARDANO_STABILITY_THRESHOLD_DEPTH = '3';
    process.env.CARDANO_STABILITY_THRESHOLD_UNIQUE_POOLS = '3';
    process.env.CARDANO_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS = '6000';

    const loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    const configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'cardanoLightClientMode') return 'stake-weighted-stability';
        if (key === 'cardanoChainId') return 'cardano-devnet';
        if (key === 'cardanoNetwork') return 'Preview';
        if (key === 'deployment') {
          return {
            hostStateNFT: {
              policyId: 'a'.repeat(56),
              name: 'b'.repeat(64),
            },
          };
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    historyServiceMock = {
      findLatestBlock: jest.fn().mockResolvedValue({
        height: 105,
        hash: 'latest-hash',
        prevHash: 'hash-104',
        slotNo: 1050n,
        epochNo: 7,
        timestampUnixNs: 1_500_000_000n,
        slotLeader: 'pool-e',
      }),
      findBlockByHeight: jest.fn().mockImplementation(async (height: bigint) => {
        if (height === 98n) {
          return {
            height: 98,
            hash: 'hash-98',
            prevHash: 'hash-97',
            slotNo: 980n,
            epochNo: 7,
            timestampUnixNs: 980_000_000n,
            slotLeader: 'pool-z',
          };
        }
        return {
          height: 100,
          hash: 'anchor-hash',
          prevHash: 'prev-hash',
          slotNo: 1000n,
          epochNo: 7,
          timestampUnixNs: 1_000_000_000n,
          slotLeader: 'pool-a',
        };
      }),
      findDescendantBlocks: jest.fn().mockResolvedValue([
        {
          height: 101,
          hash: 'hash-101',
          prevHash: 'anchor-hash',
          slotNo: 1010n,
          epochNo: 7,
          timestampUnixNs: 1_100_000_000n,
          slotLeader: 'pool-a',
        },
        {
          height: 102,
          hash: 'hash-102',
          prevHash: 'hash-101',
          slotNo: 1020n,
          epochNo: 7,
          timestampUnixNs: 1_200_000_000n,
          slotLeader: 'pool-b',
        },
        {
          height: 103,
          hash: 'hash-103',
          prevHash: 'hash-102',
          slotNo: 1030n,
          epochNo: 7,
          timestampUnixNs: 1_300_000_000n,
          slotLeader: 'pool-c',
        },
        {
          height: 104,
          hash: 'hash-104',
          prevHash: 'hash-103',
          slotNo: 1040n,
          epochNo: 7,
          timestampUnixNs: 1_400_000_000n,
          slotLeader: 'pool-d',
        },
        {
          height: 105,
          hash: 'hash-105',
          prevHash: 'hash-104',
          slotNo: 1050n,
          epochNo: 7,
          timestampUnixNs: 1_500_000_000n,
          slotLeader: 'pool-e',
        },
      ]),
      findEpochContextAtBlock: jest.fn().mockResolvedValue({
        epoch: 7,
        stakeDistribution: [
          { poolId: 'pool-a', stake: 200n, vrfKeyHash: 'aa'.repeat(32) },
          { poolId: 'pool-b', stake: 200n, vrfKeyHash: 'bb'.repeat(32) },
          { poolId: 'pool-c', stake: 200n, vrfKeyHash: 'cc'.repeat(32) },
          { poolId: 'pool-d', stake: 200n, vrfKeyHash: 'dd'.repeat(32) },
          { poolId: 'pool-e', stake: 200n, vrfKeyHash: 'ee'.repeat(32) },
        ],
        verificationContext: {
          epochNonce: '11'.repeat(32),
          slotsPerKesPeriod: 129600,
          currentEpochStartSlot: 900n,
          currentEpochEndSlotExclusive: 2000n,
        },
      }),
      findBridgeBlocks: jest.fn().mockResolvedValue([
        {
          height: 99,
          hash: 'hash-99',
          prevHash: 'hash-98',
          slotNo: 990n,
          epochNo: 7,
          timestampUnixNs: 990_000_000n,
          slotLeader: 'pool-z',
        },
      ]),
      findHostStateUtxoAtOrBeforeBlockNo: jest.fn().mockResolvedValue({
        txHash: 'host-state-tx',
        txId: 1,
        outputIndex: 0,
        address: 'addr_test1...',
        assetsPolicy: 'a'.repeat(56),
        assetsName: 'b'.repeat(64),
        datumHash: 'cd'.repeat(32),
        datum: 'datum-cbor',
        blockNo: 99,
        blockId: 99,
        index: 0,
      }),
      findTransactionEvidenceByHash: jest.fn().mockResolvedValue({
        txHash: 'host-state-tx',
        blockNo: 99,
        txIndex: 0,
        txCborHex: '01',
        txBodyCborHex: '02',
        redeemers: [],
      }),
    };

    service = new QueryService(
      loggerMock,
      configServiceMock,
      {
        decodeDatum: jest.fn(),
        LucidImporter: {
          SLOT_CONFIG_NETWORK: {
            Preview: {
              zeroTime: 1_700_000_000_000,
              slotLength: 1_000,
            },
          },
        },
      } as unknown as LucidService,
      {} as KupoService,
      historyServiceMock as unknown as HistoryService,
      {
        fetchBlocksCbor: jest.fn(),
      } as unknown as MiniProtocalsService,
      {} as MithrilService,
      {} as DenomTraceService,
    );
  });

  afterEach(() => {
    delete process.env.CARDANO_STABILITY_THRESHOLD_DEPTH;
    delete process.env.CARDANO_STABILITY_THRESHOLD_UNIQUE_POOLS;
    delete process.env.CARDANO_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS;
  });

  it('rejects stability new-client creation when requested anchor height is not a HostState tx block', async () => {
    await expect(service.queryNewClient({ height: 100n } as any)).rejects.toThrow(
      'requested stability anchor height 100 is not a HostState tx block height',
    );
  });

  it('rejects stability header generation when requested anchor height is not a HostState tx block', async () => {
    await expect(service.queryIBCHeader({ height: 100n, trusted_height: 98n } as any)).rejects.toThrow(
      'requested stability anchor height 100 is not a HostState tx block height',
    );
  });
});
