import { TxController } from '../tx.controller';
import { ClientService } from '../client.service';
import { ConnectionService } from '../connection.service';
import { ChannelService } from '../channel.service';
import { PacketService } from '../packet.service';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import handlerDatumMockBuilder from './mock/handler-datum';
import handlerUtxoMockBuilder from './mock/handler-utxo';
import { configHandler } from './mock/handler';
import { clientDatumMockBuilder } from './mock/client-datum';
import {
  MsgConnectionOpenAck,
  MsgConnectionOpenAckResponse,
  MsgConnectionOpenInit,
  MsgConnectionOpenInitResponse,
} from '@cosmjs-types/src/ibc/core/connection/v1/tx';
import msgConnectionOpenInitMockBuilder from './mock/msg-connection-open-int';
import msgConnectionOpenAckMockBuilder from './mock/msg-connection-open-ack';
import connectionDatumMockBuilder from './mock/connection-datum';
import {
  MsgAcknowledgement,
  MsgAcknowledgementResponse,
  MsgRecvPacket,
  MsgRecvPacketResponse,
  MsgTimeout,
  MsgTimeoutRefresh,
  MsgTimeoutRefreshResponse,
  MsgTimeoutResponse,
  MsgTransfer,
  MsgTransferResponse,
} from '@cosmjs-types/src/ibc/core/channel/v1/tx';
import msgRecvPacketMockBuilder from './mock/msg-recv-packet';
import channelDatumMockBuilder from './mock/channel-datum';
import msgSendPacketMockBuilder from './mock/msg-send-packet';
import msgAcknowledgePacketMockBuilder from './mock/msg-ack-packet';
import { convertString2Hex } from '@shared/helpers/hex';
import msgTimeOutPacketMockBuilder from './mock/msg-timeout-packet';
import msgTimeoutRefreshMockBuilder from './mock/msg-timeout-refresh-packet';

const clientTokenUnit =
  '2954599599f3200cf37ae003e4775668fd312332675504b1fee7f43694051031ba171ddc7783efe491f76b4d2f1ba640f2c9db64323435';

jest.mock('@shared/types/apps/transfer/types/fungible-token-packet-data', () => {
  return {
    castToFungibleTokenPacket: jest.fn().mockImplementation((data) => {
      return new Promise((resolve) => resolve(''));
    }),
  };
});
describe('TxController - Packet', () => {
  let controller: TxController;
  const mockLucidService = {
    findUtxoByUnit: jest.fn().mockImplementation(() => {
      return new Promise((resolve) => resolve(handlerUtxoMockBuilder.build()));
    }),
    findUtxoAtHandlerAuthToken: jest.fn().mockImplementation(() => {
      return new Promise((resolve) => resolve(handlerUtxoMockBuilder.build()));
    }),
    getClientAuthTokenUnit: jest.fn().mockImplementation(() => clientTokenUnit),
    decodeDatum: jest.fn().mockImplementation((_, type) => {
      if (type === 'handler') return handlerDatumMockBuilder.build();
      if (type === 'client') return clientDatumMockBuilder.build();
      if (type === 'connection') return connectionDatumMockBuilder.build();
      if (type === 'channel') return channelDatumMockBuilder.withChannelState('Open').build();
    }),
    encode: jest.fn().mockImplementation(async (object, type) => {
      switch (type) {
        case 'mintClientOperator':
          return 'd8799fd8799f581cb92d67b266fe85023e63d418329003e298783f487373a7f0adf59a4c4768616e646c6572ffff';
        case 'handlerOperator':
          return 'd87980';
        case 'handler':
          return 'd8799fd8799f070605a21863d87a801864d87a80ffd8799f581cb92d67b266fe85023e63d418329003e298783f487373a7f0adf59a4c4768616e646c6572ffff';
        case 'client':
          return 'd8799fd8799fd8799f4973696465636861696ed8799f0103ff1b00004e94914f00001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f001a00036d40ff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffa1d8799f001a00036d40ffd8799f1b17c0d2ad0913b05958202800ed0dcc0a263ab5e6ede7846ef368dd7e3218d0d749e0965fced0c5294667d8799f58207cddffb29294833fc977e362d42da7c329e5de8844d0e9cd4c28909cb0e7284cffffffd8799f581cd8eb6002f13ddcedc0eaea14c1de735ef8bcbd406994e92f8719a78e5819ce52cefc337632623d13194c25eb90c346d13c6cf2c9db6436ffff';
        default:
          return '';
      }
    }),
    getHandlerTokenUnit: jest.fn().mockImplementation(() => ''),
    findUtxoAtWithUnit: jest.fn().mockImplementation(() => ''),
    getConnectionTokenUnit: jest.fn().mockImplementation(() => ''),
    getChannelTokenUnit: jest.fn().mockImplementation(() => ''),
    getClientPolicyId: jest.fn().mockImplementation(() => ''),
    getChannelPolicyId: jest.fn().mockImplementation(() => ''),
    getConnectionPolicyId: jest.fn().mockImplementation(() => ''),
    generateTokenName: jest.fn().mockImplementation(() => ''),
    getClientTokenUnit: jest.fn().mockImplementation(() => ''),
    credentialToAddress: jest.fn().mockImplementation(() => ''),
    createUnsignedRecvPacketMintTx: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
    createUnsignedSendPacketEscrowTx: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
    createUnsignedAckPacketSucceedTx: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
    createUnsignedAckPacketUnescrowTx: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
    createUnsignedSendPacketBurnTx: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
    createUnsignedRecvPacketUnescrowTx: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
    createUnsignedTimeoutPacketMintTx: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
    createUnsignedTimeoutPacketUnescrowTx: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
    createUnsignedTimeoutRefreshTx: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TxController],
      providers: [
        ClientService,
        ConnectionService,
        ChannelService,
        PacketService,
        Logger,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              // this is being super extra, in the case that you need multiple keys with the `get` method
              if (key === 'deployment') return configHandler;
            }),
          },
        },
        // LucidService,
        {
          provide: LucidService,
          useValue: mockLucidService,
        },
      ],
    }).compile();
    controller = module.get<TxController>(TxController);
  });
  describe('TxController - Recv packet', () => {
    let request: MsgRecvPacket;
    request = msgRecvPacketMockBuilder.build();
    it('should call recv packet mint Tx successfully', async () => {
      const data: MsgRecvPacketResponse = await controller.RecvPacket(request);
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should call recv packet escrow Tx successfully', async () => {
      const data: MsgRecvPacketResponse = await controller.RecvPacket(
        msgRecvPacketMockBuilder
          .withData(
            Buffer.from(
              '7b22616d6f756e74223a2232303030222c2264656e6f6d223a22706f72742d39392f6368616e6e656c2d31342f7374616b65222c227265636569766572223a223234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238222c2273656e646572223a22636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b36227d',
              'hex',
            ),
          )
          .build(),
      );
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should return error if signer is null', async () => {
      const expectedMessage =
        '{"error":"Invalid constructed address: Signer is not valid","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgConnectionOpenInitResponse = await controller.RecvPacket(
          msgRecvPacketMockBuilder.withSigner('').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if channel is invalid', async () => {
      const expectedMessage =
        '{"error":"Invalid argument: \\"destination_channel\\". Please use the prefix \\"channel-\\"","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgConnectionOpenInitResponse = await controller.RecvPacket(
          msgRecvPacketMockBuilder.withChannelId('invalidId').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if destination_port is invalid', async () => {
      const expectedMessage =
        '{"error":"Invalid argument: \\"destination_port\\" invalidPort not supported","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgConnectionOpenInitResponse = await controller.RecvPacket(
          msgRecvPacketMockBuilder.withDestinationPort('invalidPort').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if channel state is not Open', async () => {
      const expectedMessage =
        '{"error":"An unexpected error occurred. Error: SendPacket to channel not in Open state","type":"string","exceptionName":"RpcException"}';
      jest
        .spyOn(mockLucidService, 'decodeDatum')
        .mockImplementationOnce(() => Promise.resolve(channelDatumMockBuilder.withChannelState('openTry').build()));
      try {
        const data: MsgConnectionOpenInitResponse = await controller.RecvPacket(msgRecvPacketMockBuilder.build());
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if proofHeight is invalid', async () => {
      const expectedMessage = '{"error":"Invalid proof height:';
      try {
        const data: MsgConnectionOpenInitResponse = await controller.RecvPacket(
          msgRecvPacketMockBuilder.withProofHeight(0n, 0n).build(),
        );
        expect(data).toContain(expectedMessage);
      } catch (err) {
        expect(err.message).toContain(expectedMessage);
      }
    });
  });
  describe('TxController - Send packet', () => {
    let request: MsgTransfer;
    request = msgSendPacketMockBuilder.build();
    it('should call send packet escrow Tx successfully', async () => {
      const data: MsgTransferResponse = await controller.Transfer(request);
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should call send packet burn Tx successfully', async () => {
      const data: MsgTransferResponse = await controller.Transfer(
        msgSendPacketMockBuilder.withTokenDenom('port-100/channel-14/stake').build(),
      );
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should return error if signer is null', async () => {
      const expectedMessage =
        '{"error":"Invalid constructed address: sender is not valid","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgTransferResponse = await controller.Transfer(msgSendPacketMockBuilder.withSender('').build());
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if receiver is null ', async () => {
      const expectedMessage =
        '{"error":"Invalid constructed address: receiver is not valid","type":"string","exceptionName":"RpcException"}';

      try {
        const data: MsgTransferResponse = await controller.Transfer(msgSendPacketMockBuilder.withReceiver('').build());
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if source channel is invalid', async () => {
      const expectedMessage =
        '{"error":"Invalid argument: \\"source_channel\\". Please use the prefix \\"channel-\\"","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgTransferResponse = await controller.Transfer(
          msgSendPacketMockBuilder.withSourceChannel('invalid-source-channel').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
  });

  describe('TxController - Acknowledgement packet', () => {
    let request: MsgAcknowledgement;
    request = msgAcknowledgePacketMockBuilder.build();
    it('should call ack packet succeed Tx successfully', async () => {
      const data: MsgAcknowledgementResponse = await controller.Acknowledgement(request);
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should call ack packet unescrow Tx successfully', async () => {
      const data: MsgAcknowledgementResponse = await controller.Acknowledgement(
        msgAcknowledgePacketMockBuilder
          .withAcknowledgement(Buffer.from(convertString2Hex('{"err":""}'), 'hex'))
          .build(),
      );
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should call ack packet mint Tx successfully', async () => {
      const data: MsgAcknowledgementResponse = await controller.Acknowledgement(
        msgAcknowledgePacketMockBuilder
          .withAcknowledgement(Buffer.from(convertString2Hex('{"err":""}'), 'hex'))
          .withData(
            Buffer.from(
              '7b22616d6f756e74223a2232303030222c2264656e6f6d223a22706f72742d3130302f6368616e6e656c2d31342f7374616b65222c227265636569766572223a223234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238222c2273656e646572223a22636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b36227d',
              'hex',
            ),
          )
          .build(),
      );
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should return error if signer is null', async () => {
      const expectedMessage =
        '{"error":"Invalid constructed address: Signer is not valid","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgAcknowledgementResponse = await controller.Acknowledgement(
          msgAcknowledgePacketMockBuilder.withSigner('').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if source channel is invalid ', async () => {
      const expectedMessage =
        '{"error":"Invalid argument: \\"source_channel\\". Please use the prefix \\"channel-\\"","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgAcknowledgementResponse = await controller.Acknowledgement(
          msgAcknowledgePacketMockBuilder.withSourceChannel('invalid-source-channel').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if source-port is invalid ', async () => {
      const expectedMessage =
        '{"error":"Invalid argument: \\"source_port\\" invalid-source-port not supported","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgAcknowledgementResponse = await controller.Acknowledgement(
          msgAcknowledgePacketMockBuilder.withSourcePort('invalid-source-port').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if state is not open ', async () => {
      const expectedMessage =
        '{"error":"An unexpected error occurred. Error: SendPacket to channel not in Open state","type":"string","exceptionName":"RpcException"}';
      jest
        .spyOn(mockLucidService, 'decodeDatum')
        .mockImplementationOnce(() => Promise.resolve(channelDatumMockBuilder.withChannelState('openTry').build()));
      try {
        const data: MsgAcknowledgementResponse = await controller.Acknowledgement(
          msgAcknowledgePacketMockBuilder.build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if ack response is invalid ', async () => {
      const expectedMessage =
        '{"error":"Acknowledgement Response invalid: unknown result","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgAcknowledgementResponse = await controller.Acknowledgement(
          msgAcknowledgePacketMockBuilder
            .withAcknowledgement(Buffer.from(convertString2Hex('{"invalid":""}'), 'hex'))
            .build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if ack response result !=1 ', async () => {
      const expectedMessage =
        '{"error":"Acknowledgement Response invalid: result must be 01","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgAcknowledgementResponse = await controller.Acknowledgement(
          msgAcknowledgePacketMockBuilder
            .withAcknowledgement(Buffer.from(convertString2Hex('{"result":"invalid"}'), 'hex'))
            .build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
  });

  describe('TxController - Timeout packet', () => {
    let request: MsgTimeout;
    request = msgTimeOutPacketMockBuilder.build();
    it('should call timeout packet unescrow Tx successfully', async () => {
      const data: MsgTimeoutResponse = await controller.Timeout(request);
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should call timeout packet mint Tx successfully', async () => {
      const data: MsgTimeoutResponse = await controller.Timeout(
        msgTimeOutPacketMockBuilder
          .withData(
            Buffer.from(
              '7b22616d6f756e74223a2232303030222c2264656e6f6d223a22706f72742d3130302f6368616e6e656c2d31342f7374616b65222c227265636569766572223a223234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238222c2273656e646572223a22636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b36227d',
              'hex',
            ),
          )
          .build(),
      );
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should return error if signer is null', async () => {
      const expectedMessage =
        '{"error":"Invalid constructed address: sender is not valid","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgTimeoutResponse = await controller.Timeout(msgTimeOutPacketMockBuilder.withSigner('').build());
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if source_channel is invalid', async () => {
      const expectedMessage =
        '{"error":"Invalid argument: \\"channel_id\\". Please use the prefix \\"channel-\\"","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgTimeoutResponse = await controller.Timeout(
          msgTimeOutPacketMockBuilder.withSourceChannel('invalid-source-channel').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if proof unreceive is invalid', async () => {
      const expectedMessage = '{"error":"Error decoding merkle proof:';
      try {
        const data: MsgTimeoutResponse = await controller.Timeout(
          msgTimeOutPacketMockBuilder
            .withProofUnreceived(
              Buffer.from(
                '7b22616d6f756e74223a2232303030222c2264656e6f6d223a22706f72742d3130302f6368616e6e656c2d31342f7374616b65222c227265636569766572223a223234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238222c2273656e646572223a22636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b36227d',
                'hex',
              ),
            )
            .build(),
        );
        expect(data).toContain(expectedMessage);
      } catch (err) {
        expect(err.message).toContain(expectedMessage);
      }
    });
    it('should return error if proofHeight is invalid', async () => {
      const expectedMessage = '{"error":"Invalid proof height';
      try {
        const data: MsgTimeoutResponse = await controller.Timeout(
          msgTimeOutPacketMockBuilder.withProofHeight(0n, 0n).build(),
        );
        expect(data).toContain(expectedMessage);
      } catch (err) {
        expect(err.message).toContain(expectedMessage);
      }
    });
  });

  describe('TxController - Timeout refresh packet', () => {
    let request: MsgTimeoutRefresh;
    request = msgTimeoutRefreshMockBuilder.build();
    it('should call timeout refresh packet successfully', async () => {
      const data: MsgTimeoutRefreshResponse = await controller.TimeoutRefresh(request);
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should return error if signer is null', async () => {
      const expectedMessage =
        '{"error":"Invalid constructed address: Signer is not valid","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgTimeoutRefreshResponse = await controller.TimeoutRefresh(
          msgTimeoutRefreshMockBuilder.withSigner('').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if channel id is invalid', async () => {
      const expectedMessage =
        '{"error":"Invalid argument: \\"channel_id\\". Please use the prefix \\"channel-\\"","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgTimeoutRefreshResponse = await controller.TimeoutRefresh(
          msgTimeoutRefreshMockBuilder.withChannelId('invalid-channel-id').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
  });
});
