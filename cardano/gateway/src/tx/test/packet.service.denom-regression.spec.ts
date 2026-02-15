import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { convertHex2String, convertString2Hex, hashSHA256, hashSha3_256 } from '@shared/helpers/hex';
import { DenomTraceService } from '../../query/services/denom-trace.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { IbcTreePendingUpdatesService } from '../../shared/services/ibc-tree-pending-updates.service';
import { PacketService } from '../packet.service';

jest.mock('../../shared/types/connection/verify-proof-redeemer', () => ({
  encodeVerifyProofRedeemer: jest.fn(() => 'encoded-verify-proof-redeemer'),
}));

describe('PacketService denom regression coverage', () => {
  it('resolves ibc/<hash> to canonical denom and uses burn path packet/module denoms', async () => {
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

    const lucidServiceMock = {
      getChannelTokenUnit: jest.fn().mockReturnValue(['channel-policy-id', 'channel-token-name']),
      getConnectionTokenUnit: jest.fn().mockReturnValue(['connection-policy-id', 'connection-token-name']),
      getClientTokenUnit: jest.fn().mockReturnValue('client-token-unit'),
      findUtxoByUnit: jest.fn(),
      decodeDatum: jest.fn(),
      encode: jest.fn().mockResolvedValue('encoded'),
      findUtxoAtWithUnit: jest.fn(),
      tryFindUtxosAt: jest.fn(),
      createUnsignedSendPacketBurnTx: jest.fn().mockReturnValue({ tag: 'unsigned-burn' }),
      createUnsignedSendPacketEscrowTx: jest.fn().mockReturnValue({ tag: 'unsigned-escrow' }),
    };

    const denomTraceServiceMock = {
      findByIbcDenomHash: jest.fn(),
      saveDenomTrace: jest.fn(),
    };

    const service = new PacketService(
      loggerMock,
      configServiceMock,
      lucidServiceMock as unknown as LucidService,
      denomTraceServiceMock as unknown as DenomTraceService,
      {} as IbcTreePendingUpdatesService,
    );

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

    const senderAddress = 'addr_test1sender';
    const canonicalDenom = 'transfer/channel-7/transfer/channel-1/factory/osmo1abcd/mytoken';
    const ibcHash = hashSHA256(convertString2Hex(canonicalDenom)).toUpperCase();
    denomTraceServiceMock.findByIbcDenomHash.mockResolvedValue({
      path: 'transfer/channel-7/transfer/channel-1',
      base_denom: 'factory/osmo1abcd/mytoken',
    });

    const voucherTokenName = hashSha3_256(convertString2Hex(canonicalDenom));
    const voucherTokenUnit = `mint-voucher-policy-id${voucherTokenName}`;
    const senderVoucherUtxo = {
      txHash: 'sender-voucher-utxo',
      outputIndex: 1,
      assets: {
        [voucherTokenUnit]: 50n,
        lovelace: 2_000_000n,
      },
    };
    lucidServiceMock.findUtxoAtWithUnit.mockResolvedValue(senderVoucherUtxo);
    lucidServiceMock.tryFindUtxosAt.mockResolvedValue([
      {
        txHash: 'sender-base-utxo',
        outputIndex: 0,
        assets: { lovelace: 4_000_000n },
      },
    ]);

    await service.buildUnsignedSendPacketTx({
      sourcePort: 'transfer',
      sourceChannel: 'channel-7',
      token: {
        denom: `ibc/${ibcHash}`,
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

    expect(denomTraceServiceMock.findByIbcDenomHash).toHaveBeenCalledWith(ibcHash.toLowerCase());
    expect(lucidServiceMock.createUnsignedSendPacketBurnTx).toHaveBeenCalledTimes(1);
    expect(lucidServiceMock.createUnsignedSendPacketEscrowTx).not.toHaveBeenCalled();

    const spendChannelCall = lucidServiceMock.encode.mock.calls.find(([, type]) => type === 'spendChannelRedeemer');
    expect(spendChannelCall).toBeDefined();
    const packetDataHex = spendChannelCall?.[0]?.SendPacket?.packet?.data as string;
    const packetData = JSON.parse(convertHex2String(packetDataHex));
    expect(packetData.denom).toBe(canonicalDenom);

    const transferModuleCall = lucidServiceMock.encode.mock.calls.find(([, type]) => type === 'iBCModuleRedeemer');
    expect(transferModuleCall).toBeDefined();
    const transferModuleDenomHex =
      transferModuleCall?.[0]?.Operator?.[0]?.TransferModuleOperator?.[0]?.Transfer?.data?.denom;
    expect(transferModuleDenomHex).toBe(convertString2Hex(canonicalDenom));
  });

  it('uses sha3_256(data.denom) for acknowledgement-error refund voucher minting', async () => {
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
              refValidator: {
                acknowledge_packet: {
                  scriptHash: 'ack-packet-policy-id',
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
            },
          },
        };
      }),
    } as unknown as ConfigService;

    const lucidServiceMock = {
      getChannelTokenUnit: jest.fn().mockReturnValue(['channel-policy-id', 'channel-token-name']),
      getConnectionTokenUnit: jest.fn().mockReturnValue(['connection-policy-id', 'connection-token-name']),
      getClientTokenUnit: jest.fn().mockReturnValue('client-token-unit'),
      findUtxoByUnit: jest.fn(),
      decodeDatum: jest.fn(),
      encode: jest.fn().mockResolvedValue('encoded'),
      credentialToAddress: jest.fn().mockReturnValue('addr_test1senderresolved'),
      createUnsignedAckPacketMintTx: jest.fn().mockReturnValue({ tag: 'unsigned-ack-mint' }),
      createUnsignedAckPacketUnescrowTx: jest.fn().mockReturnValue({ tag: 'unsigned-ack-unescrow' }),
      createUnsignedAckPacketSucceedTx: jest.fn().mockReturnValue({ tag: 'unsigned-ack-succeed' }),
      LucidImporter: {},
    };

    const denomTraceServiceMock = {
      saveDenomTrace: jest.fn().mockResolvedValue({}),
      findByIbcDenomHash: jest.fn(),
    };

    const service = new PacketService(
      loggerMock,
      configServiceMock,
      lucidServiceMock as unknown as LucidService,
      denomTraceServiceMock as unknown as DenomTraceService,
      {} as IbcTreePendingUpdatesService,
    );

    jest.spyOn(service as any, 'refreshWalletContext').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'buildHostStateUpdateForHandlePacket').mockResolvedValue({
      hostStateUtxo: { txHash: 'host', outputIndex: 0, assets: {} },
      encodedHostStateRedeemer: 'encoded-host-state-redeemer',
      encodedUpdatedHostStateDatum: 'encoded-updated-host-state-datum',
      newRoot: 'new-root',
      commit: jest.fn(),
    });

    const packetSequence = 9n;
    const channelDatum = {
      port: convertString2Hex('transfer'),
      state: {
        channel: {
          state: 'Open',
          connection_hops: [convertString2Hex('connection-0')],
          counterparty: {
            port_id: convertString2Hex('transfer'),
            channel_id: convertString2Hex('channel-44'),
          },
        },
        packet_commitment: new Map<bigint, string>([[packetSequence, 'commitment']]),
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
    const proofHeight = {
      revisionNumber: 0n,
      revisionHeight: 10n,
    };
    const clientDatum = {
      state: {
        clientState: {
          chainId: '',
        },
        consensusStates: new Map([[proofHeight, { timestamp: 0n }]]),
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
      if (type === 'client') return clientDatum;
      return {};
    });

    const canonicalDenom = 'transfer/channel-7/transfer/channel-1/factory/osmo1abcd/mytoken';
    const packetData = {
      denom: canonicalDenom,
      amount: '10',
      sender: 'sender-credential',
      receiver: 'receiver-credential',
      memo: '',
    };

    await service.buildUnsignedAcknowlegementPacketTx(
      {
        channelId: 'channel-7',
        packetSequence,
        packetData: convertString2Hex(JSON.stringify(packetData)),
        proofHeight,
        proofAcked: { proofs: [] } as any,
        acknowledgement: convertString2Hex(JSON.stringify({ error: 'forwarding failed' })),
        timeoutHeight: {
          revisionNumber: 0n,
          revisionHeight: 0n,
        },
        timeoutTimestamp: 0n,
      },
      'addr_test1operator',
    );

    const expectedTokenName = hashSha3_256(convertString2Hex(canonicalDenom));
    const expectedDoublePrefixed = hashSha3_256(convertString2Hex(`transfer/channel-7/${canonicalDenom}`));
    expect(expectedTokenName).not.toBe(expectedDoublePrefixed);

    expect(lucidServiceMock.createUnsignedAckPacketMintTx).toHaveBeenCalledWith(
      expect.objectContaining({
        voucherTokenUnit: `mint-voucher-policy-id${expectedTokenName}`,
      }),
    );
    const ackMintDto = lucidServiceMock.createUnsignedAckPacketMintTx.mock.calls[0]?.[0];
    expect(ackMintDto).not.toHaveProperty('denomToken');
    expect(lucidServiceMock.createUnsignedAckPacketUnescrowTx).not.toHaveBeenCalled();
    expect(lucidServiceMock.createUnsignedAckPacketSucceedTx).not.toHaveBeenCalled();

    expect(denomTraceServiceMock.saveDenomTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        hash: expectedTokenName,
        path: 'transfer/channel-7/transfer/channel-1',
        base_denom: 'factory/osmo1abcd/mytoken',
      }),
    );
  });
});
