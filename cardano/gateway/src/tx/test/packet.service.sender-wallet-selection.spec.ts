import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { convertString2Hex } from '@shared/helpers/hex';
import { DenomTraceService } from '../../query/services/denom-trace.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { IbcTreePendingUpdatesService } from '../../shared/services/ibc-tree-pending-updates.service';
import { PacketService } from '../packet.service';

describe('PacketService sender wallet selection for escrow', () => {
  let service: PacketService;
  let lucidServiceMock: {
    getChannelTokenUnit: jest.Mock;
    getConnectionTokenUnit: jest.Mock;
    getClientTokenUnit: jest.Mock;
    findUtxoByUnit: jest.Mock;
    findUtxoAt: jest.Mock;
    decodeDatum: jest.Mock;
    encode: jest.Mock;
    createUnsignedSendPacketEscrowTx: jest.Mock;
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
        if (key !== 'deployment') return undefined;
        return {
          validators: {
            spendChannel: {
              address: 'addr_test1spendchannel',
              refValidator: {
                send_packet: {
                  scriptHash: 'send-packet-policy-id',
                },
              },
            },
          },
          modules: {
            transfer: {
              identifier: 'transfer-module-identifier',
              address: 'addr_test1transfermodule',
            },
          },
        };
      }),
    } as unknown as ConfigService;

    lucidServiceMock = {
      getChannelTokenUnit: jest.fn().mockReturnValue(['channel-policy-id', 'channel-token-name']),
      getConnectionTokenUnit: jest.fn().mockReturnValue(['connection-policy-id', 'connection-token-name']),
      getClientTokenUnit: jest.fn().mockReturnValue('client-token-unit'),
      findUtxoByUnit: jest.fn(),
      findUtxoAt: jest.fn(),
      decodeDatum: jest.fn(),
      encode: jest.fn().mockResolvedValue('encoded'),
      createUnsignedSendPacketEscrowTx: jest.fn().mockReturnValue({ tag: 'unsigned-escrow' }),
    };

    service = new PacketService(
      loggerMock,
      configServiceMock,
      lucidServiceMock as unknown as LucidService,
      {} as DenomTraceService,
      {} as IbcTreePendingUpdatesService,
    );

    // Keep this test scoped to escrow wallet-selection behavior instead of HostState internals.
    jest.spyOn(service as any, 'buildHostStateUpdateForHandlePacket').mockResolvedValue({
      hostStateUtxo: { txHash: 'host', outputIndex: 0, assets: {} },
      encodedHostStateRedeemer: 'encoded-host-state-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-updated-host-state-datum',
      newRoot: 'new-root',
      commit: jest.fn(),
    });

    const channelDatum = {
      port: convertString2Hex('transfer'),
      state: {
        channel: {
          state: 'Open',
          ordering: 'Unordered',
          counterparty: {
            port_id: convertString2Hex('transfer'),
            channel_id: convertString2Hex('channel-99'),
          },
          connection_hops: [convertString2Hex('connection-0')],
        },
        next_sequence_send: 1n,
        packet_commitment: new Map<bigint, string>(),
      },
    };

    const connectionDatum = {
      state: {
        client_id: convertString2Hex('07-tendermint-0'),
      },
    };

    lucidServiceMock.findUtxoByUnit
      .mockResolvedValueOnce({ txHash: 'channel', outputIndex: 0, datum: 'channel-datum', assets: {} })
      .mockResolvedValueOnce({ txHash: 'connection', outputIndex: 0, datum: 'connection-datum', assets: {} })
      .mockResolvedValueOnce({ txHash: 'client', outputIndex: 0, datum: 'client-datum', assets: {} })
      .mockResolvedValueOnce({ txHash: 'transfer', outputIndex: 0, datum: 'transfer-datum', assets: {} });

    lucidServiceMock.decodeDatum.mockImplementation((_datum: string, type: string) => {
      if (type === 'channel') return channelDatum;
      if (type === 'connection') return connectionDatum;
      return {};
    });
  });

  it('uses sender wallet UTxOs for escrow and returns wallet override', async () => {
    const senderAddress = 'addr_test1sender';
    // Minimal sender wallet snapshot: one ADA-bearing UTxO is enough to validate
    // that escrow assembly receives sender-owned coin selection inputs.
    const senderWalletUtxos = [
      {
        txHash: 'sender-utxo-1',
        outputIndex: 0,
        assets: { lovelace: 4_000_000n },
      },
    ];
    lucidServiceMock.findUtxoAt.mockResolvedValue(senderWalletUtxos);

    const result = await service.buildUnsignedSendPacketTx({
      sourcePort: 'transfer',
      sourceChannel: 'channel-7',
      token: {
        denom: 'stake',
        amount: 10n,
      },
      sender: senderAddress,
      receiver: 'cosmos1receiver',
      timeoutHeight: {
        revisionNumber: 0n,
        revisionHeight: 0n,
      },
      timeoutTimestamp: 0n,
      memo: '',
      signer: 'addr_test1operator',
    });

    // Assert both assembly-time and completion-time wallet hooks receive sender UTxOs.
    expect(lucidServiceMock.findUtxoAt).toHaveBeenCalledWith(senderAddress);
    expect(lucidServiceMock.createUnsignedSendPacketEscrowTx).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAddress,
        walletUtxos: senderWalletUtxos,
      }),
    );
    expect(result.walletOverride).toEqual({
      address: senderAddress,
      utxos: senderWalletUtxos,
    });
  });

  it('fails hard when sender wallet UTxOs cannot be resolved for escrow', async () => {
    // No sender UTxOs means we must fail instead of trying to assemble with operator wallet.
    lucidServiceMock.findUtxoAt.mockResolvedValue([]);

    await expect(
      service.buildUnsignedSendPacketTx({
        sourcePort: 'transfer',
        sourceChannel: 'channel-7',
        token: {
          denom: 'stake',
          amount: 10n,
        },
        sender: 'addr_test1sender',
        receiver: 'cosmos1receiver',
        timeoutHeight: {
          revisionNumber: 0n,
          revisionHeight: 0n,
        },
        timeoutTimestamp: 0n,
        memo: '',
        signer: 'addr_test1operator',
      }),
    ).rejects.toThrow('No spendable UTxOs found for sender');

    expect(lucidServiceMock.createUnsignedSendPacketEscrowTx).not.toHaveBeenCalled();
  });
});
