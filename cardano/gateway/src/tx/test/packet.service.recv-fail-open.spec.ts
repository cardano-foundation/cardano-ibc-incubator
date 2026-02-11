import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { convertString2Hex } from '@shared/helpers/hex';
import { DenomTraceService } from '../../query/services/denom-trace.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { IbcTreePendingUpdatesService } from '../../shared/services/ibc-tree-pending-updates.service';
import { PacketService } from '../packet.service';

jest.mock('../../shared/types/connection/verify-proof-redeemer', () => {
  const actual = jest.requireActual('../../shared/types/connection/verify-proof-redeemer');
  return {
    ...actual,
    encodeVerifyProofRedeemer: jest.fn(() => 'encoded-verify-proof'),
  };
});

describe('PacketService recv packet fail-open regression', () => {
  let service: PacketService;
  let loggerMock: {
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
  };
  let configServiceMock: {
    get: jest.Mock;
  };
  let lucidServiceMock: {
    getChannelTokenUnit: jest.Mock;
    getConnectionTokenUnit: jest.Mock;
    getClientTokenUnit: jest.Mock;
    findUtxoByUnit: jest.Mock;
    decodeDatum: jest.Mock;
    encode: jest.Mock;
    createUnsignedRecvPacketTx: jest.Mock;
    createUnsignedRecvPacketMintTx: jest.Mock;
    LucidImporter: Record<string, unknown>;
  };

  beforeEach(() => {
    loggerMock = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const deploymentConfig = {
      validators: {
        spendChannel: {
          refValidator: {
            recv_packet: {
              scriptHash: 'recv-policy-id',
            },
          },
        },
        verifyProof: {
          scriptHash: 'verify-proof-policy-id',
        },
        mintVoucher: {
          scriptHash: 'mint-voucher-policy-id',
        },
      },
      modules: {
        transfer: {
          identifier: 'transfer-module-identifier',
          address: 'addr_test1transfer',
        },
      },
    };

    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'deployment') return deploymentConfig;
        return undefined;
      }),
    };

    lucidServiceMock = {
      getChannelTokenUnit: jest.fn().mockReturnValue(['channel-policy-id', 'channel-token-name']),
      getConnectionTokenUnit: jest.fn().mockReturnValue(['connection-policy-id', 'connection-token-name']),
      getClientTokenUnit: jest.fn().mockReturnValue('client-token-unit'),
      findUtxoByUnit: jest.fn(),
      decodeDatum: jest.fn(),
      encode: jest.fn().mockResolvedValue('encoded'),
      createUnsignedRecvPacketTx: jest.fn(),
      createUnsignedRecvPacketMintTx: jest.fn(),
      LucidImporter: {},
    };

    service = new PacketService(
      loggerMock as unknown as Logger,
      configServiceMock as unknown as ConfigService,
      lucidServiceMock as unknown as LucidService,
      {} as DenomTraceService,
      {} as IbcTreePendingUpdatesService,
    );
  });

  it('rejects malformed ICS-20 JSON instead of falling back to generic recv processing', async () => {
    const fallbackUnsignedTx = { tag: 'fallback-non-ics20' };

    lucidServiceMock.createUnsignedRecvPacketTx.mockReturnValue(fallbackUnsignedTx);
    lucidServiceMock.createUnsignedRecvPacketMintTx.mockReturnValue({ tag: 'ics20-mint' });

    lucidServiceMock.findUtxoByUnit
      .mockResolvedValueOnce({ datum: 'channel-datum' })
      .mockResolvedValueOnce({ datum: 'connection-datum' })
      .mockResolvedValueOnce({ datum: 'client-datum' })
      .mockResolvedValueOnce({ datum: 'transfer-module-datum' });

    const proofHeight = {
      revisionNumber: 0n,
      revisionHeight: 10n,
    };

    const channelDatum = {
      port: convertString2Hex('transfer'),
      state: {
        channel: {
          state: 'Open',
          ordering: 'Unordered',
          counterparty: {
            port_id: convertString2Hex('transfer'),
            channel_id: convertString2Hex('channel-7'),
          },
          connection_hops: [convertString2Hex('connection-0')],
        },
        next_sequence_recv: 1n,
        packet_receipt: new Map<bigint, string>(),
        packet_acknowledgement: new Map<bigint, string>(),
      },
    };

    const connectionDatum = {
      state: {
        client_id: convertString2Hex('07-tendermint-0'),
        delay_period: 0n,
        counterparty: {
          prefix: {
            key_prefix: convertString2Hex('ibc'),
          },
        },
      },
    };

    const clientDatum = {
      state: {
        clientState: {},
        consensusStates: new Map([[proofHeight, {}]]),
      },
    };

    lucidServiceMock.decodeDatum.mockImplementation((_datum: string, type: string) => {
      if (type === 'channel') return channelDatum;
      if (type === 'connection') return connectionDatum;
      if (type === 'client') return clientDatum;
      return {};
    });

    jest.spyOn(service as any, 'buildHostStateUpdateForHandlePacket').mockResolvedValue({
      hostStateUtxo: {},
      encodedHostStateRedeemer: 'encoded-host-state-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-updated-host-state-datum',
      newRoot: 'next-root',
      commit: jest.fn(),
    });

    const recvPacketOperator = {
      channelId: 'channel-1',
      packetSequence: 1n,
      packetData: convertString2Hex('{bad}'),
      proofCommitment: { proofs: [] },
      proofHeight,
      timeoutHeight: {
        revisionNumber: 0n,
        revisionHeight: 0n,
      },
      timeoutTimestamp: 0n,
    };

    await expect(
      (service as any).buildUnsignedRecvPacketTx(recvPacketOperator, 'addr_test1constructed'),
    ).rejects.toThrow();

    expect(lucidServiceMock.createUnsignedRecvPacketTx).not.toHaveBeenCalled();
    expect(lucidServiceMock.createUnsignedRecvPacketMintTx).not.toHaveBeenCalled();
  });
});
