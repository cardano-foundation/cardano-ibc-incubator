import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClientState as ClientStateStability,
  ConsensusState as ConsensusStateStability,
} from '@plus/proto-types/build/ibc/lightclients/stability/v1/stability';
import { StabilityHeader } from '@plus/proto-types/build/ibc/lightclients/stability/v1/stability';
import { QueryService } from '../services/query.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { DenomTraceService } from '../services/denom-trace.service';
import { HistoryService } from '../services/history.service';

const STABILITY_SLOT_ORIGIN_NS = 1_700_000_000_000_000_000n;
const timestampForSlot = (slot: bigint) => STABILITY_SLOT_ORIGIN_NS + slot * 1_000_000_000n;

describe('QueryService stability anchor contract', () => {
  let service: QueryService;
  let loggerMock: {
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };
  let lucidServiceMock: {
    decodeDatum: jest.Mock;
    findUtxoAtHostStateNFT: jest.Mock;
    LucidImporter: {
      SLOT_CONFIG_NETWORK: {
        Preview: {
          zeroTime: number;
          slotLength: number;
        };
      };
    };
  };
  let historyServiceMock: {
    findLatestBlock: jest.Mock;
    findBlockByHeight: jest.Mock;
    findDescendantBlocks: jest.Mock;
    findEpochContextAtBlock: jest.Mock;
    findBridgeBlocks: jest.Mock;
    findHostStateUtxoAtOrBeforeBlockNo: jest.Mock;
    findTransactionEvidenceByHash: jest.Mock;
  };
  let miniProtocalsServiceMock: {
    fetchBlocksCbor: jest.Mock;
  };

  beforeEach(() => {
    process.env.CARDANO_STABILITY_THRESHOLD_DEPTH = '3';
    process.env.CARDANO_STABILITY_THRESHOLD_UNIQUE_POOLS = '3';
    process.env.CARDANO_STABILITY_THRESHOLD_UNIQUE_STAKE_BPS = '6000';

    loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

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
        timestampUnixNs: timestampForSlot(1050n),
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
            timestampUnixNs: timestampForSlot(980n),
            slotLeader: 'pool-z',
          };
        }
        return {
          height: 100,
          hash: 'anchor-hash',
          prevHash: 'prev-hash',
          slotNo: 1000n,
          epochNo: 7,
          timestampUnixNs: timestampForSlot(1000n),
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
          timestampUnixNs: timestampForSlot(1010n),
          slotLeader: 'pool-a',
        },
        {
          height: 102,
          hash: 'hash-102',
          prevHash: 'hash-101',
          slotNo: 1020n,
          epochNo: 7,
          timestampUnixNs: timestampForSlot(1020n),
          slotLeader: 'pool-b',
        },
        {
          height: 103,
          hash: 'hash-103',
          prevHash: 'hash-102',
          slotNo: 1030n,
          epochNo: 7,
          timestampUnixNs: timestampForSlot(1030n),
          slotLeader: 'pool-c',
        },
        {
          height: 104,
          hash: 'hash-104',
          prevHash: 'hash-103',
          slotNo: 1040n,
          epochNo: 7,
          timestampUnixNs: timestampForSlot(1040n),
          slotLeader: 'pool-d',
        },
        {
          height: 105,
          hash: 'hash-105',
          prevHash: 'hash-104',
          slotNo: 1050n,
          epochNo: 7,
          timestampUnixNs: timestampForSlot(1050n),
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
          timestampUnixNs: timestampForSlot(990n),
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

    lucidServiceMock = {
      decodeDatum: jest.fn(),
      findUtxoAtHostStateNFT: jest.fn(),
      LucidImporter: {
        SLOT_CONFIG_NETWORK: {
          Preview: {
            zeroTime: 1_700_000_000_000,
            slotLength: 1_000,
          },
        },
      },
    };
    miniProtocalsServiceMock = {
      fetchBlocksCbor: jest.fn(),
    };

    service = new QueryService(
      loggerMock as unknown as Logger,
      configServiceMock,
      lucidServiceMock as unknown as LucidService,
      {} as KupoService,
      historyServiceMock as unknown as HistoryService,
      miniProtocalsServiceMock as unknown as MiniProtocalsService,
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

  it('populates legacy epoch mirrors in the initial stability client payload', async () => {
    historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue({
      txHash: 'host-state-tx',
      txId: 1,
      outputIndex: 0,
      address: 'addr_test1...',
      assetsPolicy: 'a'.repeat(56),
      assetsName: 'b'.repeat(64),
      datumHash: 'cd'.repeat(32),
      datum: 'datum-cbor',
      blockNo: 100,
      blockId: 100,
      index: 0,
    });
    lucidServiceMock.decodeDatum.mockResolvedValue({
      state: {
        ibc_state_root: 'ab'.repeat(32),
      },
    });

    const response = await service.queryNewClient({ height: 100n } as any);
    const clientState = ClientStateStability.decode(response.client_state!.value);
    const consensusState = ConsensusStateStability.decode(response.consensus_state!.value);

    expect(clientState.epoch_contexts).toHaveLength(1);
    expect(clientState.epoch_nonce).toHaveLength(32);
    expect(clientState.epoch_nonce).toEqual(clientState.epoch_contexts[0].epoch_nonce);
    expect(clientState.epoch_stake_distribution).toEqual(clientState.epoch_contexts[0].stake_distribution);
    expect(clientState.slots_per_kes_period).toBe(129600n);
    expect(clientState.current_epoch_start_slot).toBe(900n);
    expect(clientState.current_epoch_end_slot_exclusive).toBe(2000n);
    expect(clientState.system_start_unix_ns).toBe(STABILITY_SLOT_ORIGIN_NS);
    expect(clientState.slot_length_ns).toBe(1_000_000_000n);
    expect(consensusState.timestamp).toBe(timestampForSlot(1000n));
  });

  it('normalizes equal trusted and anchor heights to the previous trusted block for stability headers', async () => {
    historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue({
      txHash: 'host-state-tx',
      txId: 1,
      outputIndex: 0,
      address: 'addr_test1...',
      assetsPolicy: 'a'.repeat(56),
      assetsName: 'b'.repeat(64),
      datumHash: 'cd'.repeat(32),
      datum: 'datum-cbor',
      blockNo: 100,
      blockId: 100,
      index: 0,
    });
    historyServiceMock.findBridgeBlocks.mockResolvedValue([]);
    miniProtocalsServiceMock.fetchBlocksCbor.mockResolvedValue([
      Buffer.from('01', 'hex'),
      Buffer.from('02', 'hex'),
      Buffer.from('03', 'hex'),
      Buffer.from('04', 'hex'),
      Buffer.from('05', 'hex'),
      Buffer.from('06', 'hex'),
    ]);

    const response = await service.queryIBCHeader({ height: 100n, trusted_height: 100n } as any);
    const header = StabilityHeader.decode(response.header!.value);

    expect(header.trusted_height?.revision_height).toBe(99n);
    expect(header.anchor_block?.height?.revision_height).toBe(100n);
  });

  it('reuses the live HostState tx height when the current epoch context point is too old', async () => {
    lucidServiceMock.findUtxoAtHostStateNFT.mockResolvedValue({
      txHash: 'live-host-state-tx',
      outputIndex: 0,
    });
    historyServiceMock.findTransactionEvidenceByHash.mockResolvedValue({
      txHash: 'live-host-state-tx',
      blockNo: 1136,
      txIndex: 0,
      txCborHex: '',
      txBodyCborHex: '',
      redeemers: [],
    });
    historyServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockResolvedValue({
      txHash: 'live-host-state-tx',
      txId: 1,
      outputIndex: 0,
      address: 'addr_test1...',
      assetsPolicy: 'a'.repeat(56),
      assetsName: 'b'.repeat(64),
      datumHash: 'cd'.repeat(32),
      datum: 'datum-cbor',
      blockNo: 1136,
      blockId: 1136,
      index: 0,
    });
    historyServiceMock.findBlockByHeight.mockResolvedValue({
      height: 1136,
      hash: 'hash-1136',
      prevHash: 'hash-1135',
      slotNo: 4452n,
      epochNo: 0,
      timestampUnixNs: timestampForSlot(4452n),
      slotLeader: 'pool-a',
    });
    historyServiceMock.findDescendantBlocks.mockResolvedValue([]);
    historyServiceMock.findEpochContextAtBlock.mockRejectedValue(
      new Error('Failed to acquire requested point. Target point is too old.'),
    );

    await expect(service.latestStabilityHeight()).resolves.toEqual({ height: 1136n });
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('reusing that height until a newer HostState tx is available'),
    );
  });

  it('rejects stability header generation when requested anchor height is not a HostState tx block', async () => {
    await expect(service.queryIBCHeader({ height: 100n, trusted_height: 98n } as any)).rejects.toThrow(
      'requested stability anchor height 100 is not a HostState tx block height',
    );
  });
});
