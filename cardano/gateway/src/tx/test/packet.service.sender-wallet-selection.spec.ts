import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { convertString2Hex } from '@shared/helpers/hex';
import { DenomTraceService } from '../../query/services/denom-trace.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { PacketService } from '../packet.service';

describe('PacketService signer wallet selection for escrow', () => {
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
    tryFindUtxosAt: jest.Mock;
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
            mintVoucher: {
              scriptHash: 'mint-voucher-policy-id',
            },
            mintTransferEscrowShard: {
              scriptHash: 'mint-transfer-escrow-shard-policy-id',
            },
            mintPort: {
              scriptHash: 'mint-port-policy-id',
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
      findUtxoAt: jest.fn().mockResolvedValue([]),
      decodeDatum: jest.fn(),
      encode: jest.fn().mockResolvedValue('encoded'),
      createUnsignedSendPacketEscrowTx: jest.fn().mockReturnValue({ tag: 'unsigned-escrow' }),
      tryFindUtxosAt: jest.fn(),
    };

    service = new PacketService(
      loggerMock,
      configServiceMock,
      lucidServiceMock as unknown as LucidService,
      {} as DenomTraceService,
      {} as any,
      { executePacket: jest.fn() } as any,
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
        packet_receipt: new Map<bigint, string>(),
        packet_acknowledgement: new Map<bigint, string>(),
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

  it('uses signer wallet UTxOs for escrow and returns wallet override', async () => {
    const senderAddress = 'addr_test1sender';
    const signerAddress = 'addr_test1operator';
    // Minimal signer wallet snapshot: one ADA-bearing UTxO is enough to validate
    // that escrow assembly receives signer-owned coin selection inputs.
    const signerWalletUtxos = [
      {
        txHash: 'signer-utxo-1',
        outputIndex: 0,
        assets: { lovelace: 4_000_000n },
      },
    ];
    lucidServiceMock.tryFindUtxosAt.mockResolvedValue(signerWalletUtxos);

    const result = await service.buildUnsignedSendPacketTx({
      sourcePort: 'transfer',
      sourceChannel: 'channel-7',
      token: {
        denom: 'lovelace',
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
      signer: signerAddress,
    });

    expect(lucidServiceMock.tryFindUtxosAt).toHaveBeenCalledWith(signerAddress, {
      maxAttempts: 6,
      retryDelayMs: 1000,
    });
    // Assert both assembly-time and completion-time wallet hooks receive signer UTxOs.
    expect(lucidServiceMock.createUnsignedSendPacketEscrowTx).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAddress,
        walletUtxos: signerWalletUtxos,
      }),
    );
    expect(result.walletOverride).toEqual({
      address: signerAddress,
      utxos: signerWalletUtxos,
    });
  });

  it('fails hard when signer wallet UTxOs cannot be resolved for escrow', async () => {
    const signerAddress = 'addr_test1operator';
    // No signer UTxOs means we cannot fund or complete the escrow transaction.
    lucidServiceMock.tryFindUtxosAt.mockResolvedValue([]);

    await expect(
      service.buildUnsignedSendPacketTx({
        sourcePort: 'transfer',
        sourceChannel: 'channel-7',
        token: {
          denom: 'lovelace',
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
        signer: signerAddress,
      }),
    ).rejects.toThrow(`No spendable UTxOs found for signer ${signerAddress}`);

    expect(lucidServiceMock.createUnsignedSendPacketEscrowTx).not.toHaveBeenCalled();
  });
});
