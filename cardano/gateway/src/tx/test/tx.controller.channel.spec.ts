import { TxController } from '../tx.controller';
import { ClientService } from '../client.service';
import { ConnectionService } from '../connection.service';
import { ChannelService } from '../channel.service';
import { PacketService } from '../packet.service';
import { SubmissionService } from '../submission.service';
import { TxEventsService } from '../tx-events.service';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodecType, LucidService } from '../../shared/modules/lucid/lucid.service';
import { DenomTraceService } from 'src/query/services/denom-trace.service';
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
} from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import msgChannelOpenInitMockBuilder from './mock/msg-channel-open-int';
import { CHANNEL_ID_PREFIX } from 'src/constant';
import msgChannelOpenAckBuilder from './mock/msg-channel-open-ack';
import channelDatumMockBuilder from './mock/channel-datum';
import { GrpcInternalException } from '~@/exception/grpc_exceptions';
import { Data } from '@lucid-evolution/lucid';
import { decodeHandlerDatum, encodeHandlerDatum, HandlerDatum } from '~@/shared/types/handler-datum';
import { decodeClientDatum } from '~@/shared/types/client-datum';
import { decodeConnectionDatum } from '~@/shared/types/connection/connection-datum';
import { decodeChannelDatum } from '~@/shared/types/channel/channel-datum';
import { decodeMockModuleDatum } from '~@/shared/types/apps/mock/mock-module-datum';
import { encodeMintChannelRedeemer, MintChannelRedeemer } from '~@/shared/types/channel/channel-redeemer';
import { IbcTreePendingUpdatesService } from '~@/shared/services/ibc-tree-pending-updates.service';

const clientTokenUnit =
  '2954599599f3200cf37ae003e4775668fd312332675504b1fee7f43694051031ba171ddc7783efe491f76b4d2f1ba640f2c9db64323435';

const generateRandomHex = (length = 64) => {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
};

describe('TxController - Client', () => {
  let controller: TxController;
  const mockLucidImporter = {
    Data: Data,
  } as typeof import('@lucid-evolution/lucid');
  const mockLucidService = {
    LucidImporter: mockLucidImporter,
    findUtxoByUnit: (tokenUnit: string) => {
      return new Promise((resolve) =>
        resolve(
          handlerUtxoMockBuilder
            .withDatum(
              'd8799fd8799f4c6962635f636c69656e742d309fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f56323030302d63617264616e6f2d6d69746872696c2d304c636f6e6e656374696f6e2d31d8799f43696263ffff00ffd8799f581c076fcaa9fd53a61e201ec153fdddddf25a3c67ee3ff885058ed1edc7581939db5e79db50ec7a52602e7a965e710e2c935bcf19dd9b3030ffff',
            )
            .build(),
        ),
      );
    },
    findUtxoAtHandlerAuthToken: jest.fn().mockImplementation(() => {
      return new Promise((resolve) => resolve(handlerUtxoMockBuilder.build()));
    }),
    findUtxoAtHostStateNFT: jest.fn().mockResolvedValue({
      txHash: generateRandomHex(),
      outputIndex: 0,
      address: 'addr_test_host_state',
      assets: {},
      datum: 'host_state_datum',
    }),
    lucid: {
      SLOT_CONFIG_NETWORK: {
        Custom: { zeroTime: 0, zeroSlot: 0, slotLength: 0 },
      },
      currentSlot: () => 100,
      unixTimeToSlot: () => 200,
      config: () => ({
        network: 'Custom',
      }),
    },
    getClientAuthTokenUnit: jest.fn().mockImplementation(() => clientTokenUnit),
    decodeDatum: async <T>(encodedDatum: string, type: CodecType): Promise<T> => {
      try {
        switch (type) {
          case 'client':
            return (await decodeClientDatum(encodedDatum, mockLucidImporter)) as T;
          case 'connection':
            return (await decodeConnectionDatum(encodedDatum, mockLucidImporter)) as T;
          case 'handler':
            return {
              state: {
                next_client_sequence: 0n,
                next_connection_sequence: 0n,
                next_channel_sequence: 0n,
                bound_port: [],
                ibc_state_root: '0'.repeat(64),
              },
              token: {
                policyId: '00',
                name: '68616e646c6572',
              },
            } as T;
          case 'channel':
            return (await decodeChannelDatum(encodedDatum, mockLucidImporter)) as T;
          case 'mockModule':
            return (await decodeMockModuleDatum(encodedDatum, mockLucidImporter)) as T;
          case 'host_state':
            return {
              state: {
                version: 0n,
                ibc_state_root: '0'.repeat(64),
                next_client_sequence: 0n,
                next_connection_sequence: 0n,
                next_channel_sequence: 0n,
                bound_port: [],
                last_update_time: 0n,
              },
              nft_policy: '00',
            } as T;
          default:
            throw new Error(`Unknown datum type: ${type}`);
        }
      } catch (error) {
        throw new GrpcInternalException(`An unexpected error occurred when trying to decode ${type}: ${error}`);
      }
    },
    encode: jest.fn().mockImplementation(async (object, type) => {
      switch (type) {
        case 'mintClientOperator':
          return 'd8799fd8799f581cb92d67b266fe85023e63d418329003e298783f487373a7f0adf59a4c4768616e646c6572ffff';
        case 'handlerOperator':
          return 'd87980';
        case 'handler':
          const handlerData = {
            state: {
              next_client_sequence: 0n,
              next_connection_sequence: 0n,
              next_channel_sequence: 0n,
              bound_port: [100n],
              ibc_state_root: '0000000000000000000000000000000000000000000000000000000000000000',
            },
            token: {
              policyId: '11d98f7566bb47cd0bd738390dd8fa748167206013059a26000334b1',
              name: '68616e646c6572',
            },
          };
          return await encodeHandlerDatum(handlerData as HandlerDatum, mockLucidImporter);
        case 'client':
          return 'd8799fd8799fd8799f4973696465636861696ed8799f0103ff1b00004e94914f00001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f001a00036d40ff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffa1d8799f001a00036d40ffd8799f1b17c0d2ad0913b05958202800ed0dcc0a263ab5e6ede7846ef368dd7e3218d0d749e0965fced0c5294667d8799f58207cddffb29294833fc977e362d42da7c329e5de8844d0e9cd4c28909cb0e7284cffffffd8799f581cd8eb6002f13ddcedc0eaea14c1de735ef8bcbd406994e92f8719a78e5819ce52cefc337632623d13194c25eb90c346d13c6cf2c9db6436ffff';
        case 'mintChannelRedeemer':
          const MintRedeemerData = {
            ChanOpenInit: {
              handler_token: {
                policyId: '11d98f7566bb47cd0bd738390dd8fa748167206013059a26000334b1',
                name: '68616e646c6572',
              },
            },
          };
          return await encodeMintChannelRedeemer(MintRedeemerData as MintChannelRedeemer, mockLucidImporter);
        default:
          return '';
      }
    }),
    getHandlerTokenUnit: jest.fn().mockImplementation(() => ''),
    getChannelTokenUnit: jest.fn().mockImplementation(() => [
      '11d98f7566bb47cd0bd738390dd8fa748167206013059a26000334b1',
      '6368616e6e656c30', // fromText("channel0")
    ]),
    getConnectionTokenUnit: (connectionSequence: string) => {
      return [
        'ffd279f2b8bb524d317a1a4abcda69c5dc5979c0d10a4fd7b0a4a578',
        '39db5e79db50ec7a52602e7a965e710e2c935bcf239b722030',
      ];
    },
    getClientPolicyId: jest.fn().mockImplementation(() => ''),
    getChannelPolicyId: jest.fn().mockImplementation(() => ''),
    getConnectionPolicyId: jest.fn().mockImplementation(() => ''),
    generateTokenName: jest.fn().mockImplementation(() => ''),
    getClientTokenUnit: jest.fn().mockImplementation(() => ''),
    createUnsignedChannelOpenInitTransaction: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockResolvedValue({
          toHash: jest.fn().mockReturnValue(''),
          toCBOR: jest.fn().mockReturnValue(generateRandomHex(128)),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
          sign: {
            withWallet: jest.fn().mockImplementation(() => ({
              complete: jest.fn().mockResolvedValue({
                toHash: jest.fn().mockReturnValue(generateRandomHex()),
                toCBOR: jest.fn().mockReturnValue(generateRandomHex(128)),
                txComplete: {
                  to_bytes: jest.fn().mockReturnValue(''),
                },
              }),
            })),
          },
        }),
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
    class TestLogger extends Logger {
      log(message: string) {
        console.log('[Test Logger]', message);
      }
      error(message: string, trace: string) {
        console.error('[Test Logger]', message, trace);
      }
      warn(message: string) {
        console.warn('[Test Logger]', message);
      }
      debug(message: string) {
        console.debug('[Test Logger]', message);
      }
      verbose(message: string) {
        console.debug('[Test Logger]', message);
      }
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TxController],
      providers: [
        ClientService,
        ConnectionService,
        ChannelService,
        PacketService,
        {
          provide: DenomTraceService,
          useValue: {
            saveDenomTrace: jest.fn(),
            findByIbcDenomHash: jest.fn(),
          },
        },
        {
          provide: SubmissionService,
          useValue: {
            submitSignedTransaction: jest.fn(),
          },
        },
        {
          provide: TxEventsService,
          useValue: {
            register: jest.fn(),
            take: jest.fn(),
          },
        },
        {
          provide: IbcTreePendingUpdatesService,
          useValue: {
            register: jest.fn(),
            take: jest.fn(),
          },
        },
        { provide: Logger, useClass: TestLogger },
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
      expect(data.channel_id).toBe(`${CHANNEL_ID_PREFIX}-0`);
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
  describe.skip('TxController - Channel Open Ack', () => {
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
