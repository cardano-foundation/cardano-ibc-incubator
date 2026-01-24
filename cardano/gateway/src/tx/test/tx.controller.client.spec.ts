import { TxController } from '../tx.controller';
import { ClientService } from '../client.service';
import { ConnectionService } from '../connection.service';
import { ChannelService } from '../channel.service';
import { PacketService } from '../packet.service';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import {
  MsgCreateClient,
  MsgCreateClientResponse,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '@plus/proto-types/build/ibc/core/client/v1/tx';
import handlerDatumMockBuilder from './mock/handler-datum';
import handlerUtxoMockBuilder from './mock/handler-utxo';
import { configHandler } from './mock/handler';
import clientStateTendermintMockBuilder from './mock/client-state-tendermint';
import consensusStateTendermintMockBuilder from './mock/consensus-state-tendermint';
import { generateRandomString } from './utils/utils';
import headerMockBuilder from './mock/header';
import { clientDatumMockBuilder } from './mock/client-datum';
import msgUpdateClientMockBuilder, { MsgUpdateClientMockBuilder } from './mock/msg-update-client';
import { MAX_CHAIN_ID_LENGTH } from 'src/constant';

const clientTokenUnit =
  '2954599599f3200cf37ae003e4775668fd312332675504b1fee7f43694051031ba171ddc7783efe491f76b4d2f1ba640f2c9db64323435';

describe.skip('TxController - Client', () => {
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
    getClientPolicyId: jest.fn().mockImplementation(() => ''),
    getChannelPolicyId: jest.fn().mockImplementation(() => ''),
    getConnectionPolicyId: jest.fn().mockImplementation(() => ''),
    generateTokenName: jest.fn().mockImplementation(() => ''),
    getClientTokenUnit: jest.fn().mockImplementation(() => ''),
    createUnsignedCreateClientTransaction: jest.fn().mockImplementation(() => ({
      validTo: jest.fn().mockImplementation(() => ({
        complete: jest.fn().mockImplementation(() => ({
          toHash: jest.fn().mockReturnValue(''),
          txComplete: {
            to_bytes: jest.fn().mockReturnValue(''),
          },
        })),
      })),
    })),
    createUnsignedUpdateClientTransaction: jest.fn().mockImplementation(() => ({
      validFrom: jest.fn().mockImplementation(() => ({
        validTo: jest.fn().mockImplementation(() => ({
          complete: jest.fn().mockImplementation(() => ({
            toHash: jest.fn().mockReturnValue(''),
            txComplete: {
              to_bytes: jest.fn().mockReturnValue(''),
            },
          })),
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
  describe('TxController - Create Client', () => {
    let request: MsgCreateClient;
    request = {
      client_state: {
        type_url: '/ibc.lightclients.tendermint.v1.ClientState',
        value: clientStateTendermintMockBuilder.encode(),
      },
      consensus_state: {
        type_url: '/ibc.lightclients.tendermint.v1.ConsensusState',
        value: consensusStateTendermintMockBuilder.encode(),
      },
      signer: 'addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m',
    };
    it('should call create client successfully', async () => {
      const data: MsgCreateClientResponse = await controller.CreateClient(request);
      expect(data.client_id).toBeDefined;
      expect(data.unsigned_tx).toBeDefined;
    });
    it('should return error if signer is null', async () => {
      const expectedMessage =
        '{"error":"Invalid constructed address: Signer is not valid","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          signer: '',
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if client_state can not be decoded', async () => {
      const expectedMessage = '{"error":"Error decoding client state:';
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          client_state: {
            ...request.client_state,
            value: Buffer.from(
              '0a0b08dee88fb00610c3d4a63c12220a2041fe6949b0425e4847581af91e92522d3cd32ed6460b6f4a9100f6f1bc50e0c11a202800ed0dcc0a263ab5e6ede7846ef368dd7e3218d0d749e0965fced0c5294667',
              'hex',
            ),
          },
        });
        expect(data).toContain(expectedMessage);
      } catch (err) {
        expect(err.message).toContain(expectedMessage);
      }
    });
    it('should return error if consensus_state can not be decoded', async () => {
      const expectedMessage = '{"error":"Error decoding consensus state ouroboros:';
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          consensus_state: {
            ...request.consensus_state,
            value: Buffer.from(
              '0a0b08dee88fb00610c3d4a63c12220as2041fe6949b0425e4847581af91e92522d3cd32ed6460b6f4a9100f6f1bc50e0c11a202800ed0dcc0a263ab5e6ede7846ef368dd7e3218d0d749e0965fced0c5294667',
              'hex',
            ),
          },
        });
        expect(data).toContain(expectedMessage);
      } catch (err) {
        expect(err.message).toContain(expectedMessage);
      }
    });
    it('should return error if client state - chain id is null', async () => {
      const expectedMessage =
        '{"error":"chain id cannot be empty string","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          client_state: {
            ...request.client_state,
            value: clientStateTendermintMockBuilder.with_chain_id('').encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if client state - chain id too long (>50)', async () => {
      const chainIdLenght = 51;
      const overLengthChainId = generateRandomString({ length: chainIdLenght });
      const expectedMessage = `{"error":"chainID is too long; got: ${chainIdLenght}, max: 50","type":"string","exceptionName":"RpcException"}`;
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          client_state: {
            ...request.client_state,
            value: clientStateTendermintMockBuilder.with_chain_id(overLengthChainId).encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if client state trustLevel not within [1/3, 1]', async () => {
      const expectedMessage = `{\"error\":\"trustLevel must be within [1/3, 1]\",\"type\":\"string\",\"exceptionName\":\"RpcException\"}`;
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          client_state: {
            ...request.client_state,
            value: clientStateTendermintMockBuilder.with_trust_level(1n, 4n).encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if client state trusting period <= 0 ', async () => {
      const expectedMessage = `{\"error\":\"trusting period must be greater than zero\",\"type\":\"string\",\"exceptionName\":\"RpcException\"}`;
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          client_state: {
            ...request.client_state,
            value: clientStateTendermintMockBuilder.with_trusting_period(-1n, 0).encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if client state unbonding Period period <= 0', async () => {
      const expectedMessage = `{\"error\":\"unbonding period must be greater than zero\",\"type\":\"string\",\"exceptionName\":\"RpcException\"}`;
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          client_state: {
            ...request.client_state,
            value: clientStateTendermintMockBuilder.with_unbonding_period(-1n, 0).encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if client state maxClockDrift period <= 0', async () => {
      const expectedMessage = `{\"error\":\"max clock drift must be greater than zero\",\"type\":\"string\",\"exceptionName\":\"RpcException\"}`;
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          client_state: {
            ...request.client_state,
            value: clientStateTendermintMockBuilder.with_max_clock_drift(-1n, 0).encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if client state chainId invalid', async () => {
      const expectedMessage =
        '{"error":"Latest height revision number must match chain ID revision number","type":"string","exceptionName":"RpcException"}';
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          client_state: {
            ...request.client_state,
            value: clientStateTendermintMockBuilder.with_chain_id('abc-1').encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if client state latest revision height = 0', async () => {
      const expectedMessage = `{\"error\":\"tendermint clients latest height revision height cannot be zero\",\"type\":\"string\",\"exceptionName\":\"RpcException\"}`;
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          client_state: {
            ...request.client_state,
            value: clientStateTendermintMockBuilder.with_latest_height(0n, 0n).encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if client state trusting period >= unbonding period', async () => {
      const trusingPeriod = 100n;
      const unbondingPeriod = 99n;
      const expectedMessage = `{\"error\":\"trusting period ${trusingPeriod * 10n ** 9n} should be < unbonding period ${unbondingPeriod * 10n ** 9n}\",\"type\":\"string\",\"exceptionName\":\"RpcException\"}`;
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          client_state: {
            ...request.client_state,
            value: clientStateTendermintMockBuilder
              .with_trusting_period(100n, 0)
              .with_unbonding_period(99n, 0)
              .encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if consensus state root is empty', async () => {
      const expectedMessage = `{\"error\":\"root cannot be empty\",\"type\":\"string\",\"exceptionName\":\"RpcException\"}`;
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          consensus_state: {
            ...request.consensus_state,
            value: consensusStateTendermintMockBuilder.with_root(new Uint8Array([])).encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
    it('should return error if consensus state timestamp <= 0 ', async () => {
      const expectedMessage = `{\"error\":\"timestamp must be a positive Unix time\",\"type\":\"string\",\"exceptionName\":\"RpcException\"}`;
      try {
        const data: MsgCreateClientResponse = await controller.CreateClient({
          ...request,
          consensus_state: {
            ...request.consensus_state,
            value: consensusStateTendermintMockBuilder.with_timestamp(-2n, 0).encode(),
          },
        });
        expect(data).toBe(expectedMessage);
      } catch (err) {
        expect(err.message).toBe(expectedMessage);
      }
    });
  });
  describe('TxController - Update Client', () => {
    describe('Misbehaviour not found', () => {
      describe('typeurl = /ibc.lightclients.tendermint.v1.Header', () => {
        let request: MsgUpdateClientMockBuilder;
        beforeEach(async () => {
          request = msgUpdateClientMockBuilder.withTypeUrl('/ibc.lightclients.tendermint.v1.Header');
        });

        it('should call update client successfully', async () => {
          const data: MsgUpdateClientResponse = await controller.UpdateClient(request.build());
          expect(data.unsigned_tx).toBeDefined;
        });
        it('should return error if signer is null', async () => {
          const expectedMessage =
            '{"error":"Invalid constructed address: Signer is not valid","type":"string","exceptionName":"RpcException"}';
          try {
            const data: MsgUpdateClientResponse = await controller.UpdateClient(request.withSigner('').build());
            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if clientId is null', async () => {
          const expectedMessage = '{"error":"Invalid clientId","type":"string","exceptionName":"RpcException"}';
          try {
            const data: MsgUpdateClientResponse = await controller.UpdateClient(request.withClientId('').build());
            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if clientId is invalid', async () => {
          const expectedMessage =
            '{"error":"Invalid argument: \\"client_id\\". Please use the prefix \\"07-tendermint-\\"","type":"string","exceptionName":"RpcException"}';
          try {
            const data: MsgUpdateClientResponse = await controller.UpdateClient(
              request.withClientId('invalidclientid').build(),
            );
            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if request header is invalid', async () => {
          const expectedMessage = 'Error decoding header:';
          try {
            const data: MsgUpdateClientResponse = await controller.UpdateClient(
              msgUpdateClientMockBuilder

                .withClientMessage(
                  Buffer.from(
                    '0a0b08dee88fb00610c3d4a63c12220as2041fe6949b0425e4847581af91e92522d3cd32ed6460b6f4a9100f6f1bc50e0c11a202800ed0dcc0a263ab5e6ede7846ef368dd7e3218d0d749e0965fced0c5294667',
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
        it('should return error if can not get trusted consensus state for header at trusted height', async () => {
          const expectedMessage = '{"error":"could not get trusted consensus state for Header at TrustedHeight:';
          try {
            const data: MsgUpdateClientResponse = await controller.UpdateClient(
              request.withClientMessage(headerMockBuilder.withTrustedHeight(0n, 0n).encodeToBuffer()).build(),
            );
            expect(data).toContain(expectedMessage);
          } catch (err) {
            expect(err.message).toContain(expectedMessage);
          }
        });
        it('should return error if validator set is null', async () => {
          //Can not be tested because the error covered when when trying to decode
        });
        it('should return error if trustedValidators pubkey null', async () => {
          const expectedMessage =
            '{"error":"validator does not have a public key","type":"string","exceptionName":"RpcException"}';
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withTrustedValidatorNullPubKey().encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);

            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if trustedValidators has negative voting power', async () => {
          const expectedMessage =
            '{"error":"validator has negative voting power","type":"string","exceptionName":"RpcException"}';
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withTrustedValidatorNegativeVotingPower().encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);

            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if trustedValidators address is the wrong size:', async () => {
          const expectedMessage = '{"error":"validator address is the wrong size:';
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withTrustedValidatorWrongSizeAddress().encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);

            expect(data).toContain(expectedMessage);
          } catch (err) {
            expect(err.message).toContain(expectedMessage);
          }
        });
        it('should return error if validatorset does not have a public key', async () => {
          const expectedMessage =
            '{"error":"validator does not have a public key","type":"string","exceptionName":"RpcException"}';
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withValidatorSetValidatorPublickeyNull().encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);
            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if validatorset has negative voting power', async () => {
          const expectedMessage =
            '{"error":"validator has negative voting power","type":"string","exceptionName":"RpcException"}';
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withValidatorSetNegativeVotingPower().encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);

            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if validatorset address is the wrong size:', async () => {
          const expectedMessage = '{"error":"validator address is the wrong size:';
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withValidatorSetWrongSizeAddress().encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);

            expect(data).toContain(expectedMessage);
          } catch (err) {
            expect(err.message).toContain(expectedMessage);
          }
        });
        //proposal
        it('should return error if validatorset proposal does not have a public key', async () => {
          const expectedMessage =
            '{"error":"validator does not have a public key","type":"string","exceptionName":"RpcException"}';
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withValidatorSetValidatorProposalPublickeyNull().encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);
            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if validatorset proposal has negative voting power', async () => {
          const expectedMessage =
            '{"error":"validator has negative voting power","type":"string","exceptionName":"RpcException"}';
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withValidatorSetProposalNegativeVotingPower().encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);

            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if validatorset proposal address is the wrong size:', async () => {
          const expectedMessage = '{"error":"validator address is the wrong size:';
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withValidatorSetProposalWrongSizeAddress().encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);

            expect(data).toContain(expectedMessage);
          } catch (err) {
            expect(err.message).toContain(expectedMessage);
          }
        });
        //
        it('should return error if validatorSetFromProto return null:', async () => {
          jest
            .spyOn(require('@shared/types/cometbft/validator-set'), 'validatorSetFromProto')
            .mockImplementationOnce(() => {
              return null;
            });
          const expectedMessage =
            '{"error":"trusted validator set in not tendermint validator set type","type":"string","exceptionName":"RpcException"}';
          try {
            const requestUpdateClient = request.withClientMessage(headerMockBuilder.encodeToBuffer()).build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);
            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if header height <= trusted height:', async () => {
          const expectedMessage = '{"error":"header height ≤ consensus state height';
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withHeight(0n).encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);
            expect(data).toContain(expectedMessage);
          } catch (err) {
            expect(err.message).toContain(expectedMessage);
          }
        });
        //verifyNonAdjacent
        it('should return error if header height = trusted header height + 1', async () => {
          const expectedMessage = '{"error":"old header has expired at';
          try {
            const requestUpdateClient = request
              .withClientMessage(
                headerMockBuilder.withTime({ seconds: BigInt(Number.MAX_SAFE_INTEGER), nanos: 0 }).encodeToBuffer(),
              )
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);
            expect(data).toContain(expectedMessage);
          } catch (err) {
            expect(err.message).toContain(expectedMessage);
          }
        });
        it('should return error if chain Id length invalid', async () => {
          const length = MAX_CHAIN_ID_LENGTH + 1;
          const invalidChainId = generateRandomString({ length: length });
          const expectedMessage = `{\"error\":\"chainID is too long; got: ${length * 2}, max: ${MAX_CHAIN_ID_LENGTH}\",\"type\":\"string\",\"exceptionName\":\"RpcException\"}`;
          try {
            const requestUpdateClient = request
              .withClientMessage(headerMockBuilder.withChainId(invalidChainId).encodeToBuffer())
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);
            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
        it('should return error if new header time is before header time', async () => {
          const headerTimeSecond = 1611859206n;
          const headerTimeNano = 941264372;
          const invalidHeaderTime = headerTimeSecond * 10n ** 9n + BigInt(headerTimeNano);
          const expectedMessage = `{"error":"expected new header time ${invalidHeaderTime} to be after old header time 1711599499024248921","type":"string","exceptionName":"RpcException"}`;
          try {
            const requestUpdateClient = request
              .withClientMessage(
                headerMockBuilder.withTime({ seconds: headerTimeSecond, nanos: headerTimeNano }).encodeToBuffer(),
              )
              .build();
            const data: MsgUpdateClientResponse = await controller.UpdateClient(requestUpdateClient);
            expect(data).toBe(expectedMessage);
          } catch (err) {
            expect(err.message).toBe(expectedMessage);
          }
        });
      });
      //
    });
    describe('Misbehaviour found', () => {
      const request: MsgUpdateClient = msgUpdateClientMockBuilder.build();
      it('should call update client successfully', async () => {
        const data: MsgUpdateClientResponse = await controller.UpdateClient(request);
        expect(data.unsigned_tx).toBeDefined;
      });
      it('should return error if signer is null', async () => {
        const expectedMessage =
          '{"error":"Invalid constructed address: Signer is not valid","type":"string","exceptionName":"RpcException"}';
        try {
          const data: MsgUpdateClientResponse = await controller.UpdateClient(
            msgUpdateClientMockBuilder.withSigner('').build(),
          );
          expect(data).toBe(expectedMessage);
        } catch (err) {
          expect(err.message).toBe(expectedMessage);
        }
      });
    });
  });
});
