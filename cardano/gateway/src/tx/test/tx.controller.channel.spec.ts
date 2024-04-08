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
import connectionDatumMockBuilder from './mock/connection-datum';
import {
  MsgChannelOpenAck,
  MsgChannelOpenAckResponse,
  MsgChannelOpenInit,
  MsgChannelOpenInitResponse,
} from '@cosmjs-types/src/ibc/core/channel/v1/tx';
import msgChannelOpenInitMockBuilder from './mock/msg-channel-open-int';
import { CHANNEL_ID_PREFIX } from 'src/constant';
import { convertString2Hex } from '@shared/helpers/hex';
import msgChannelOpenAckBuilder from './mock/msg-channel-open-ack';
import channelDatumMockBuilder from './mock/channel-datum';

const clientTokenUnit =
  '2954599599f3200cf37ae003e4775668fd312332675504b1fee7f43694051031ba171ddc7783efe491f76b4d2f1ba640f2c9db64323435';

describe('TxController - Client', () => {
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
      if (type === 'channel') return channelDatumMockBuilder.build();
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
    getChannelTokenUnit: jest.fn().mockImplementation(() => ''),
    getConnectionTokenUnit: jest.fn().mockImplementation(() => ''),
    getClientPolicyId: jest.fn().mockImplementation(() => ''),
    getChannelPolicyId: jest.fn().mockImplementation(() => ''),
    getConnectionPolicyId: jest.fn().mockImplementation(() => ''),
    generateTokenName: jest.fn().mockImplementation(() => ''),
    getClientTokenUnit: jest.fn().mockImplementation(() => ''),
    createUnsignedChannelOpenInitTransaction: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
    createUnsignedChannelOpenAckTransaction: jest.fn().mockImplementation(() => ({
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
  describe('TxController - Channel Open Init', () => {
    let request: MsgChannelOpenInit;
    request = msgChannelOpenInitMockBuilder.build();
    it('should call channel open init successfully', async () => {
      const data: MsgChannelOpenInitResponse = await controller.ChannelOpenInit(request);
      expect(data.unsigned_tx).toBeDefined;
      expect(data.channel_id).toBe(convertString2Hex(CHANNEL_ID_PREFIX + '-' + '5'));
      expect(data.version).toBeDefined;
    });
    it('should return error if signer is null', async () => {
      const expectedMessage =
        '{"error":"Invalid constructed address: Signer is not valid","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgChannelOpenInitResponse = await controller.ChannelOpenInit(
          msgChannelOpenInitMockBuilder.withSigner('').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if connection hops is empty', async () => {
      const expectedMessage =
        '{"error":"Invalid connection id: Connection Id is not valid","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgChannelOpenInitResponse = await controller.ChannelOpenInit(
          msgChannelOpenInitMockBuilder.withConnectionHops([]).build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
  });
  describe('TxController - Channel Open Ack', () => {
    let request: MsgChannelOpenAck;
    request = msgChannelOpenAckBuilder.build();
    it('should call channel open ack successfully', async () => {
      const data: MsgChannelOpenAckResponse = await controller.ChannelOpenAck(request);
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should return error if signer is null', async () => {
      const expectedMessage =
        '{"error":"Invalid constructed address: Signer is not valid","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgChannelOpenAckResponse = await controller.ChannelOpenAck(
          msgChannelOpenAckBuilder.withSigner('').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if channel Id is invalid', async () => {
      const expectedMessage =
        '{"error":"Invalid argument: \\"channel_id\\". Please use the prefix \\"channel-\\"","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgChannelOpenAckResponse = await controller.ChannelOpenAck(
          msgChannelOpenAckBuilder.withChannelId('invalid-channel-id').build(),
        );
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if proof try can not be decoded', async () => {
      const expectedMessage = '{"error":"Error decoding merkle proof:';
      try {
        const data: MsgChannelOpenAckResponse = await controller.ChannelOpenAck(
          msgChannelOpenAckBuilder
            .withProofTry(
              Buffer.from(
                '0a0b08dee88fb00610c3d4a63c12220a2041fe6949b0425e4847581af91e92522d3cd32ed6460b6f4a9100f6f1bc50e0c11a202800ed0dcc0a263ab5e6ede7846ef368dd7e3218d0d749e0965fced0c5294667',
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
    it('should return error if proof height is invalid', async () => {
      const expectedMessage = '{"error":"Invalid proof height:';
      try {
        const data: MsgChannelOpenAckResponse = await controller.ChannelOpenAck(
          msgChannelOpenAckBuilder.withProofHeight(0n, 0n).build(),
        );
        expect(data).toContain(expectedMessage);
      } catch (err) {
        expect(err.message).toContain(expectedMessage);
      }
    });
    it('should return error if channel datum state is not init', async () => {
      const expectedMessage =
        '{"error":"ChanOpenAck to channel not in Init state","type":"string","exceptionName":"RpcException"}';
      jest
        .spyOn(mockLucidService, 'decodeDatum')
        .mockImplementationOnce(() => Promise.resolve(channelDatumMockBuilder.withChannelState('open').build()));
      try {
        const data: MsgChannelOpenAckResponse = await controller.ChannelOpenAck(msgChannelOpenAckBuilder.build());
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
  });
});
