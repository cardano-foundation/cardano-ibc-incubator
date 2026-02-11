import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryService } from '../services/query.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { DbSyncService } from '../services/db-sync.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { DenomTraceService } from '../services/denom-trace.service';

jest.mock('@plus/proto-types/build/ibc/lightclients/mithril/v1/mithril', () => {
  const actual = jest.requireActual('@plus/proto-types/build/ibc/lightclients/mithril/v1/mithril');
  return {
    ...actual,
    MithrilHeader: {
      ...actual.MithrilHeader,
      encode: jest.fn().mockReturnValue({
        finish: () => new Uint8Array([0]),
      }),
    },
  };
});

const makeCertificate = (overrides: Record<string, unknown> = {}) => ({
  hash: 'cert-default',
  previous_hash: undefined,
  epoch: '1',
  signed_entity_type: {},
  metadata: {
    network: 'preview',
    version: '1',
    parameters: {
      k: '1',
      m: '1',
      phi_f: 0.5,
    },
    initiated_at: '2026-01-01T00:00:00.000000000Z',
    sealed_at: '2026-01-01T00:00:01.000000000Z',
    signers: [],
  },
  protocol_message: {
    message_parts: {},
  },
  signed_message: '',
  aggregate_verification_key: '',
  genesis_signature: '',
  multi_signature: null,
  ...overrides,
});

describe('QueryService IBC header strictness regressions', () => {
  let service: QueryService;
  let dbServiceMock: {
    findHostStateUtxoAtOrBeforeBlockNo: jest.Mock;
    findBlockByHeight: jest.Mock;
  };
  let mithrilServiceMock: {
    getMostRecentMithrilStakeDistributions: jest.Mock;
    getCardanoTransactionsSetSnapshot: jest.Mock;
    getProofsCardanoTransactionList: jest.Mock;
    getCertificateByHash: jest.Mock;
  };

  beforeEach(() => {
    const loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;

    const configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'cardanoChainId') return 'cardano-devnet';
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

    dbServiceMock = {
      findHostStateUtxoAtOrBeforeBlockNo: jest
        .fn()
        .mockResolvedValueOnce({ txHash: 'tx-A', blockNo: 300, outputIndex: 0 })
        .mockResolvedValueOnce({ txHash: 'tx-B', blockNo: 200, outputIndex: 1 })
        .mockResolvedValueOnce({ txHash: 'tx-C', blockNo: 100, outputIndex: 2 }),
      findBlockByHeight: jest.fn().mockResolvedValue({ hash: 'block-100', slot: 123 }),
    };

    const snapshots = [
      {
        block_number: '300',
        certificate_hash: 'cert-300',
        hash: 'snapshot-300',
        epoch: '3',
        created_at: '2026-01-03T00:00:00.000000000Z',
        merkle_root: 'root-300',
      },
      {
        block_number: '200',
        certificate_hash: 'cert-200',
        hash: 'snapshot-200',
        epoch: '2',
        created_at: '2026-01-02T00:00:00.000000000Z',
        merkle_root: 'root-200',
      },
      {
        block_number: '100',
        certificate_hash: 'cert-100',
        hash: 'snapshot-100',
        epoch: '1',
        created_at: '2026-01-01T00:00:00.000000000Z',
        merkle_root: 'root-100',
      },
    ];

    mithrilServiceMock = {
      getMostRecentMithrilStakeDistributions: jest.fn().mockResolvedValue([
        {
          epoch: '1',
          hash: 'stake-dist-hash',
          certificate_hash: 'dist-cert',
          created_at: '2026-01-01T00:00:00.000000000Z',
        },
      ]),
      getCardanoTransactionsSetSnapshot: jest.fn().mockResolvedValue(snapshots),
      getProofsCardanoTransactionList: jest
        .fn()
        .mockResolvedValueOnce({ latest_block_number: '200', certificate_hash: 'cert-200' })
        .mockResolvedValueOnce({ latest_block_number: '100', certificate_hash: 'cert-100' }),
      getCertificateByHash: jest.fn().mockImplementation(async (hash: string) => {
        if (hash === 'cert-100') {
          return makeCertificate({
            hash: 'cert-100',
            previous_hash: 'dist-cert',
            epoch: '1',
            signed_entity_type: {
              CardanoTransactions: ['1', '100'],
            },
          });
        }
        if (hash === 'dist-cert') {
          return makeCertificate({
            hash: 'dist-cert',
            previous_hash: undefined,
            epoch: '1',
            signed_entity_type: {
              MithrilStakeDistribution: {},
            },
          });
        }
        return makeCertificate({ hash });
      }),
    };

    service = new QueryService(
      loggerMock,
      configServiceMock,
      {} as LucidService,
      {} as KupoService,
      dbServiceMock as unknown as DbSyncService,
      {
        fetchBlockHeader: jest.fn().mockResolvedValue({ bodyCbor: 'beef' }),
      } as unknown as MiniProtocalsService,
      mithrilServiceMock as unknown as MithrilService,
      {} as DenomTraceService,
    );

    jest.spyOn(service as any, 'findTxBodyHexInBlock').mockReturnValue('beef');
  });

  it('fails hard when snapshot/proof/HostState alignment cannot converge in bounded attempts', async () => {
    await expect(service.queryIBCHeader({ height: 250n } as any)).rejects.toThrow(
      'Failed to converge Mithril snapshot/proof/HostState alignment',
    );
    expect(dbServiceMock.findBlockByHeight).not.toHaveBeenCalled();
  });

  it('fails hard when previous stake-distribution artifact is missing during certificate-chain construction', async () => {
    dbServiceMock.findHostStateUtxoAtOrBeforeBlockNo.mockReset();
    dbServiceMock.findHostStateUtxoAtOrBeforeBlockNo
      .mockResolvedValueOnce({ txHash: 'tx-A', blockNo: 300, outputIndex: 0 })
      .mockResolvedValueOnce({ txHash: 'tx-A', blockNo: 300, outputIndex: 0 });

    mithrilServiceMock.getProofsCardanoTransactionList.mockReset();
    mithrilServiceMock.getProofsCardanoTransactionList.mockResolvedValueOnce({
      latest_block_number: '300',
      certificate_hash: 'cert-300',
    });

    mithrilServiceMock.getCertificateByHash.mockReset();
    mithrilServiceMock.getCertificateByHash.mockImplementation(async (hash: string) => {
      if (hash === 'cert-300') {
        return makeCertificate({
          hash: 'cert-300',
          previous_hash: 'dist-cert',
          epoch: '3',
          signed_entity_type: {
            CardanoTransactions: ['3', '300'],
          },
        });
      }
      if (hash === 'dist-cert') {
        return makeCertificate({
          hash: 'dist-cert',
          previous_hash: 'older-cert',
          epoch: '2',
          signed_entity_type: {
            MithrilStakeDistribution: {},
          },
        });
      }
      if (hash === 'older-cert') {
        return makeCertificate({
          hash: 'older-cert',
          previous_hash: undefined,
          epoch: '1',
          signed_entity_type: {
            MithrilStakeDistribution: {},
          },
        });
      }
      return makeCertificate({ hash });
    });

    await expect(service.queryIBCHeader({ height: 250n } as any)).rejects.toThrow(
      'Mithril stake distribution artifact missing for previous certificate older-cert',
    );
    expect(dbServiceMock.findBlockByHeight).not.toHaveBeenCalled();
  });
});
