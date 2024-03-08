import { Test, TestingModule } from '@nestjs/testing';
import { QueryController } from '../query.controller';
import { QueryService } from '../services/query.service';
import { DbSyncService } from '../services/db-sync.service';
import { ConnectionService } from '../services/connection.service';
import { ChannelService } from '../services/channel.service';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import {
  QueryBlockDataRequest,
  QueryClientStateRequest,
  QueryConsensusStateRequest,
  QueryLatestHeightRequest,
  QueryNewClientRequest,
} from '@cosmjs-types/src/ibc/core/client/v1/query';
import { QueryBlockResultsRequest } from '@cosmjs-types/src/ibc/core/types/v1/query';
import { GrpcNotFoundException } from 'nestjs-grpc-exceptions';
import { HttpModule, HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { of } from 'rxjs';
import { StateQueryClient, createStateQueryClient } from '@cardano-ogmios/client/dist/StateQuery';

import blockDataMock from './mock/block-data';
import { clientDatumMock } from './mock/client-datum';
import { handlerDatumMock } from './mock/handler-datum';
import { queryClientMock } from './mock/query-client';
import { configHandler } from './mock/handler';
import { dbServiceMock } from './mock/db-sync';
import { connectionDatumMock } from './mock/connection-datum';
import {
  block_results as blockResults,
  query_connections_expected as queryConnectionsExpected,
  query_connection_expected as queryConnectionExpected,
  query_channels_expected as queryChannelsExpected,
  query_channel_expected as queryChannelExpected,
} from './mock/expected_data';
import { QueryConnectionRequest, QueryConnectionsRequest } from '@cosmjs-types/src/ibc/core/connection/v1/query';
import { PageRequest } from '@cosmjs-types/src/cosmos/base/query/v1beta1/pagination';
import { PacketService } from '../services/packet.service';
import {
  QueryChannelRequest,
  QueryChannelsRequest,
  QueryConnectionChannelsRequest,
} from '../../../cosmjs-types/src/ibc/core/channel/v1/query';
import { channelDatumMock } from './mock/channel-datum';

const { block_data: blockData, expected_data: queryBlockDataExpected } = blockDataMock;

const utxoMock = {
  txHash: '07048b71db748bf7c95f864139dd1c3e73d5cee25e297f74251385a487a9962c',
  outputIndex: 0,
  address: 'addr_test1wqqs9872rwc7mu282445vn903l4j2xe2q64e4nx9wjayu6gha9nff',
  assets: {
    lovelace: 1305930n,
    ae402aa242a85d03dde0913882ec6cb0f36edec61ccd501692de147268616e646c6572: 1n,
  },
  datumHash: null,
  datum:
    'd8799fd8799f18ca189c15ffd8799f581cae402aa242a85d03dde0913882ec6cb0f36edec61ccd501692de14724768616e646c6572ffff',
  scriptRef: null,
};

const clientTokenUnit =
  '2954599599f3200cf37ae003e4775668fd312332675504b1fee7f43694051031ba171ddc7783efe491f76b4d2f1ba640f2c9db64323435';

const mockDbService = {
  findHeightByTxHash: jest.fn().mockImplementation((data) => {
    return new Promise((resolve) => resolve(dbServiceMock.findHeightByTxHash));
  }),
  findBlockByHeight: jest.fn().mockImplementation((height) => {
    if (height === 650879n) return new Promise((resolve) => resolve(dbServiceMock.findBlockByHeight));
    throw new GrpcNotFoundException(`Not found: "height" ${height} not found`);
  }),
  findEpochParamByEpochNo: jest.fn().mockImplementation((epochNo) => {
    if (epochNo === 6n) return new Promise((resolve) => resolve(dbServiceMock.findEpochParamByEpochNo));
    throw new GrpcNotFoundException(`Not found: "epochNo" ${epochNo} not found`);
  }),
  findActiveValidatorsByEpoch: jest.fn().mockImplementation((epochNo) => {
    if (epochNo === 6n) return new Promise((resolve) => resolve(dbServiceMock.findActiveValidatorsByEpoch));
    if (epochNo === 7n) return new Promise((resolve) => resolve([]));
    throw new GrpcNotFoundException(`Not found: "epochNo" ${epochNo} not found`);
  }),
  findUtxosByBlockNo: jest.fn().mockImplementation((height) => {
    return new Promise((resolve) => resolve(dbServiceMock.findUtxosByBlockNo));
  }),
  findUtxoClientOrAuthHandler: jest.fn().mockImplementation((height) => {
    return new Promise((resolve) => resolve(dbServiceMock.findUtxoClientOrAuthHandler));
  }),
  checkExistPoolUpdateByBlockNo: jest.fn().mockImplementation(() => {
    return new Promise((resolve) => resolve(dbServiceMock.checkExistPoolUpdateByBlockNo));
  }),
  checkExistPoolRetireByBlockNo: jest.fn().mockImplementation(() => {
    return new Promise((resolve) => resolve(dbServiceMock.checkExistPoolRetireByBlockNo));
  }),
  findUtxosByPolicyIdAndPrefixTokenName: jest.fn().mockImplementation(() => {
    return new Promise((resolve) => resolve(dbServiceMock.findUtxosByPolicyIdAndPrefixTokenName));
  }),
  findUtxoByPolicyAndTokenNameAndState: jest.fn().mockImplementation(() => {
    return new Promise((resolve) => resolve(dbServiceMock.findUtxoByPolicyAndTokenNameAndState));
  }),
  findRedemmerDataByTxId: jest.fn().mockImplementation(() => {
    return new Promise((resolve) => resolve([]));
  }),
  getRedeemersByTxIdAndMintScriptOrSpendAddr: jest.fn().mockImplementation(() => {
    return new Promise((resolve) => resolve(dbServiceMock.getRedeemersByTxIdAndMintScriptOrSpendAddr));
  }),
};
jest.mock('@shared/types/handler-datum', () => {
  return {
    decodeHandlerDatum: jest.fn().mockImplementation(() => handlerDatumMock),
  };
});
jest.mock('@shared/types/client-datum', () => {
  return {
    decodeClientDatum: jest.fn().mockImplementation((data) => {
      return new Promise((resolve) => resolve(clientDatumMock));
    }),
  };
});
jest.mock('@shared/types/connection/connection-datum', () => {
  return {
    decodeConnectionDatum: jest.fn().mockImplementation((data) => {
      return new Promise((resolve) => resolve(connectionDatumMock));
    }),
  };
});
jest.mock('@shared/types/channel/channel-datum', () => {
  return {
    decodeChannelDatum: jest.fn().mockImplementation((data) => {
      return new Promise((resolve) => resolve(channelDatumMock));
    }),
  };
});
jest.mock('@cardano-ogmios/client', () => {
  return {
    createInteractionContext: jest.fn(),
  };
});
jest.mock('@cardano-ogmios/client/dist/StateQuery', () => {
  return {
    createStateQueryClient: jest.fn().mockImplementation(() => {
      return new Promise((resolve) =>
        resolve({
          blockHeight: jest
            .fn()
            .mockImplementation(() => new Promise((resolve) => resolve(queryClientMock.blockHeight))),
          genesisConfig: jest
            .fn()
            .mockImplementation(() => new Promise((resolve) => resolve(queryClientMock.genesisConfig))),
          systemStart: jest
            .fn()
            .mockImplementation(() => new Promise((resolve) => resolve(queryClientMock.systemStart))),
        }),
      );
    }),
  };
});
const createStateQueryClientMock = jest.mocked(createStateQueryClient);

describe('QueryController', () => {
  let controller: QueryController;

  const mockLucidService = {
    findUtxoByUnit: jest.fn().mockImplementation((data) => {
      return new Promise((resolve) => resolve(utxoMock));
    }),
    getClientAuthTokenUnit: jest.fn().mockImplementation((data) => clientTokenUnit),
    getHandlerTokenUnit: jest.fn().mockImplementation(() => ''),
    getClientPolicyId: jest.fn().mockImplementation(() => ''),
    getChannelPolicyId: jest.fn().mockImplementation(() => ''),
    getConnectionPolicyId: jest.fn().mockImplementation(() => ''),
    generateTokenName: jest.fn().mockImplementation(() => ''),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      controllers: [QueryController],
      providers: [
        QueryService,
        DbSyncService,
        ConnectionService,
        ChannelService,
        PacketService,
        Logger,
        EntityManager,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              // this is being super extra, in the case that you need multiple keys with the `get` method
              switch (key) {
                case 'deployment':
                  return configHandler;
                case 'cardanoBridgeUrl':
                  return 'http://localhost:8080';
              }
              return null;
            }),
          },
        },
        {
          provide: LucidService,
          useValue: mockLucidService,
        },
        {
          provide: DbSyncService,
          useValue: mockDbService,
        },
      ],
    }).compile();
    controller = module.get<QueryController>(QueryController);
  });

  describe('Test QueryClientState', () => {
    it('QueryClientState should be called successfully', async () => {
      const data = await controller.queryClientState(<QueryClientStateRequest>{
        height: 650879n,
      });

      expect(data.client_state.type_url).toBe('/ibc.lightclients.tendermint.v1.ClientState');
      expect(Buffer.from(data.client_state.value).toString('base64')).toBe(
        'ChI3MzY5NjQ2NTYzNjg2MTY5NmUSBAgBEAMaBAjAhV4iBAiA324qAwjYBDIAOgQQ6pQGQkgKLwj///////////8BEP///////////wEY////////////ASD///////////8BKgHTEhUKAgABECEYBCAMMP///////////wFCSAovCP///////////wEQ////////////ARj///////////8BIP///////////wEqAdMSFQoCAAEQIBgBIAEw////////////AQ==',
      );
      expect(data.proof_height).toMatchObject({ revision_number: 0, revision_height: 650879 });
    });

    it('QueryClientState should be called with invalid params', async () => {
      const expectMessage =
        '{"error":"Invalid argument: \\"height\\" must be provided","type":"string","exceptionName":"RpcException"}';
      try {
        const data = await controller.queryClientState({} as unknown as QueryClientStateRequest);
        expect(data).toBe(expectMessage);
      } catch (err) {
        expect(err.message).toBe(expectMessage);
      }
    });

    it("QueryClientState should be called failed because it's not found", async () => {
      jest.spyOn(mockLucidService, 'findUtxoByUnit').mockImplementationOnce((unit) => {
        throw new GrpcNotFoundException(`Unable to find UTxO with unit ${unit}`);
      });
      const expectMessage = 'Unable to find UTxO with unit';
      try {
        const data = await controller.queryClientState(<QueryClientStateRequest>{
          height: 650879n,
        });
        expect(data).toContain(expectMessage);
      } catch (error) {
        expect(error.message).toContain(expectMessage);
      }
    });
  });

  describe('Test QueryConsensusState', () => {
    it('QueryConsensusState should be called successfully', async () => {
      const data = await controller.queryConsensusState(<QueryConsensusStateRequest>{
        height: 100970n,
      });
      expect(data.consensus_state.type_url).toBe('/ibc.lightclients.tendermint.v1.ConsensusState');
      expect(Buffer.from(data.consensus_state.value).toString('base64')).toBe(
        'CgsIu6HXrgYQgPy0XhIyCjB3p15zZ3nxzThxxt551zp7xpvjXnzjR99vjz3jfndzl7TrrzpptzjnVp1x3drjjpoaMNm29HdO+mudnnNOHdeG9tu2u/H/OdWu33/NPNdtHu+NevHOHNXuHPNO2vX9t3PfOg==',
      );
      expect(data.proof_height).toMatchObject({ revision_number: 0, revision_height: 650879 });
    });

    it('QueryConsensusState should be called with invalid params', async () => {
      const expectMessage =
        '{"error":"Invalid argument: \\"height\\" must be provided","type":"string","exceptionName":"RpcException"}';
      try {
        const data = await controller.queryConsensusState({} as unknown as QueryConsensusStateRequest);
        expect(data).toBe(expectMessage);
      } catch (err) {
        expect(err.message).toBe(expectMessage);
      }
    });

    it("QueryConsensusState should be called failed because it's not found", async () => {
      const expectMessage = 'Unable to find Consensus State at height 123';
      try {
        const data = await controller.queryConsensusState(<QueryClientStateRequest>{
          height: 123n,
        });

        expect(data).toContainEqual(expectMessage);
      } catch (error) {
        expect(error.message).toContain(expectMessage);
      }
    });
  });

  describe('Test QueryBlockData', () => {
    it('QueryBlockData should be called successfully', async () => {
      const response: AxiosResponse<any> = {
        data: blockData,
        headers: {},
        config: {
          url: '',
          headers: undefined,
        },
        status: 200,
        statusText: 'OK',
      };
      const jestMock = jest.spyOn(HttpService.prototype, 'get').mockImplementation(() => {
        return of(response);
      });
      const data = await controller.queryBlockData(<QueryBlockDataRequest>{
        height: 650879n,
      });
      expect(data.block_data.type_url).toBe(queryBlockDataExpected.type_url);
      expect(Buffer.from(data.block_data.value).toString('base64')).toBe(queryBlockDataExpected.value);

      jestMock.mockReset().mockRestore();
    });

    it('QueryBlockData should be called with invalid params', async () => {
      const expectMessage =
        '{"error":"Invalid argument: \\"height\\" must be provided","type":"string","exceptionName":"RpcException"}';
      try {
        const data = await controller.queryBlockData({} as unknown as QueryBlockDataRequest);
        expect(data).toBe(expectMessage);
      } catch (err) {
        expect(err.message).toBe(expectMessage);
      }
    });

    it("QueryBlockData should be called failed because it's not found height", async () => {
      const expectMessage = '"Not found: \\"height\\" 6508790 not found"';
      try {
        const data = await controller.queryBlockData(<QueryClientStateRequest>{
          height: 6508790n,
        });
        expect(data).toContainEqual(expectMessage);
      } catch (error) {
        expect(error.message).toContain(expectMessage);
      }
    });
  });

  describe('Test QueryLatestHeight', () => {
    it('QueryLatestHeigh should be called successfully', async () => {
      const data = await controller.LatestHeight(<QueryLatestHeightRequest>{});
      expect(data.height).toBe(650879n);
    });

    it('QueryLatestHeigh should be called failed', async () => {
      const expectMessage = 'blockHeight';
      createStateQueryClientMock.mockImplementationOnce(() => {
        return new Promise((resolve) =>
          resolve({
            blockHeight: jest
              .fn()
              .mockImplementation(() => new Promise((resolve, reject) => reject(new Error(expectMessage)))),
          } as unknown as StateQueryClient),
        );
      });
      try {
        const data = await controller.LatestHeight(<QueryLatestHeightRequest>{});
        expect(data).toBe(expectMessage);
      } catch (err) {
        expect(err.message).toBe(expectMessage);
      }
    });
  });

  describe('Test QueryNewClient', () => {
    it('QueryNewClient should be called successfully', async () => {
      const data = await controller.NewClient(<QueryNewClientRequest>{
        height: 650879n,
      });
      expect(data.client_state.type_url).toBe('/ibc.clients.cardano.v1.ClientState');
      expect(Buffer.from(data.client_state.value).toString('base64')).toBe(
        'CgI0MhIEEP/cJxoAKLizuK0GMAY4gK8aQMD0B0p8CkBmZWMxN2VkNjBjYmYyZWM1YmUzZjA2MWZiNGRlMGI2ZWYxZjIwOTQ3Y2ZiZmNlNWZiMjc4M2QxMmYzZjY5ZmY1Ejhwb29sMTNnc2VrNnZkOGRocXhzdTM0Nnp2YWUzMHI0bXRkNzd5dGgwN2ZjYzdwNDlrcWMzZmQwOWoA',
      );
      expect(data.consensus_state.type_url).toBe('/ibc.clients.cardano.v1.ConsensusState');
      expect(Buffer.from(data.consensus_state.value).toString('base64')).toBe('CM+h164GEJfungE=');
    });

    it('QueryNewClient should be called failed with invalid params', async () => {
      const expectMessage =
        '{"error":"Invalid argument: \\"height\\" must be provided","type":"string","exceptionName":"RpcException"}';
      try {
        const data = await controller.NewClient(<QueryNewClientRequest>{});
        expect(data).toBe(expectMessage);
      } catch (err) {
        expect(err.message).toBe(expectMessage);
      }
    });

    it("QueryNewClient should be called failed because it's not found height", async () => {
      const expectMessage = '"Not found: \\"height\\" 6508790 not found"';
      try {
        const data = await controller.NewClient(<QueryNewClientRequest>{ height: 6508790n });
        expect(data).toBe(expectMessage);
      } catch (err) {
        expect(err.message).toContain(expectMessage);
      }
    });
  });

  describe('Test QueryBlockResults', () => {
    it('QueryBlockResults should be called successfully', async () => {
      const data = await controller.BlockResults(<QueryBlockResultsRequest>{
        height: 650879n,
      });

      expect(data).toMatchObject(blockResults);
    });

    it('QueryBlockResults should be called failed with invalid params', async () => {
      const expectMessage =
        '{"error":"Invalid argument: \\"height\\" must be provided","type":"string","exceptionName":"RpcException"}';
      try {
        const data = await controller.BlockResults(<QueryBlockResultsRequest>{});
        expect(data).toBe(expectMessage);
      } catch (err) {
        expect(err.message).toBe(expectMessage);
      }
    });

    it("QueryBlockResults should be called failed because it's not found height", async () => {
      const expectMessage = '"Not found: \\"height\\" 6508790 not found"';
      try {
        const data = await controller.BlockResults(<QueryBlockResultsRequest>{ height: 6508790n });
        expect(data).toBe(expectMessage);
      } catch (err) {
        expect(err.message).toContain(expectMessage);
      }
    });
  });

  describe('Test QueryConnections', () => {
    it('QueryConnections should be called successfully', async () => {
      const data = await controller.queryConnections(<QueryConnectionsRequest>{
        pagination: {
          offset: 0,
          limit: 10,
        } as unknown as PageRequest,
      });
      expect(data).toMatchObject(queryConnectionsExpected);
    });

    it('QueryConnections should be called failed because required parameter `limit` was missing.', async () => {
      const expectMessage = 'Invalid argument: \\"pagination.limit\\" must be provided';
      try {
        const data = await controller.queryConnections(<QueryConnectionsRequest>{
          pagination: {
            offset: 0,
          } as unknown as PageRequest,
        });
        expect(data).toBe(expectMessage);
      } catch (error) {
        expect(error.message).toContain(expectMessage);
      }
    });

    // it('QueryConnections should be called failed because required parameters `offset` and `key` were missing.', async () => {
    //   const expectMessage = 'Invalid argument: \\"pagination.offset\\" or \\"pagination.key\\" must be provided';
    //   try {
    //     const data = await controller.queryConnections(<QueryConnectionsRequest>{
    //       pagination: {
    //         limit: 10,
    //       } as unknown as PageRequest,
    //     });
    //     expect(data).toBe(expectMessage);
    //   } catch (error) {
    //     expect(error.message).toContain(expectMessage);
    //   }
    // });

    it("QueryConnections should be called failed because it's not found connections", async () => {
      jest.spyOn(mockDbService, 'findUtxosByPolicyIdAndPrefixTokenName').mockImplementationOnce(() => {
        return [];
      });
      const expectMessage = {
        connections: [],
        pagination: {
          next_key: null,
          total: 0,
        },
        height: {
          revision_number: 0n,
          revision_height: 0n,
        },
      };
      const data = await controller.queryConnections(<QueryConnectionsRequest>{
        pagination: {
          offset: 0,
          limit: 10,
        } as unknown as PageRequest,
      });
      expect(data).toMatchObject(expectMessage);
    });
  });

  describe('Test QueryConnection', () => {
    it('QueryConnection should be called successfully', async () => {
      const data = await controller.queryConnection(<QueryConnectionRequest>{
        connection_id: 'connection-0',
      });

      expect(data.connection).toMatchObject(queryConnectionExpected.connection);
      expect(Buffer.from(data.proof).toString('base64')).toBe(queryConnectionExpected.proof);
      expect(data.proof_height).toMatchObject(queryConnectionExpected.proof_height);
    });

    it('QueryConnection should be called failed because required parameter `connection_id` was missing.', async () => {
      const expectMessage =
        '{"error":"Invalid argument: \\"connection_id\\" must be provided","type":"string","exceptionName":"RpcException"}';
      try {
        const data = await controller.queryConnection(<QueryConnectionRequest>{});
        expect(data).toBe(expectMessage);
      } catch (error) {
        expect(error.message).toBe(expectMessage);
      }
    });

    it('QueryConnection should be called failed because required parameter `connection_id` was missing prefix.', async () => {
      const expectMessage =
        '{"error":"Invalid argument: \\"connection_id\\". Please use the prefix \\"connection-\\"","type":"string","exceptionName":"RpcException"}';
      try {
        const data = await controller.queryConnection(<QueryConnectionRequest>{
          connection_id: '0',
        });
        expect(data).toBe(expectMessage);
      } catch (error) {
        expect(error.message).toBe(expectMessage);
      }
    });

    it("QueryConnection should be called failed because it's not found connection id", async () => {
      const expectMessage = 'Unable to find UTxO with unit';
      jest.spyOn(mockLucidService, 'findUtxoByUnit').mockImplementationOnce((unit) => {
        throw new GrpcNotFoundException(`Unable to find UTxO with unit ${unit}`);
      });
      try {
        const data = await controller.queryConnection(<QueryConnectionRequest>{
          connection_id: 'connection-6508790',
        });
        expect(data).toContain(expectMessage);
      } catch (error) {
        expect(error.message).toContain(expectMessage);
      }
    });
  });

  describe('Test QueryChannels', () => {
    it('QueryChannels should be called successfully', async () => {
      const data = await controller.queryChannels(<QueryChannelsRequest>{
        pagination: {
          offset: 0,
          limit: 10,
        } as unknown as PageRequest,
      });

      expect(data).toMatchObject(queryChannelsExpected);
    });
    it("queryChannels should be called failed because it's not found channels", async () => {
      jest.spyOn(mockDbService, 'findUtxosByPolicyIdAndPrefixTokenName').mockImplementationOnce(() => {
        return [];
      });
      const expectMessage = {
        channels: [],
        pagination: {
          next_key: null,
          total: 0,
        },
        height: {
          revision_number: 0n,
          revision_height: 0n,
        },
      };
      const data = await controller.queryChannels(<QueryChannelsRequest>{
        pagination: {
          offset: 0,
          limit: 10,
        } as unknown as PageRequest,
      });
      expect(data).toMatchObject(expectMessage);
    });
    it('queryChannels should be called failed because required parameter `limit` was missing.', async () => {
      const expectMessage = 'Invalid argument: \\"pagination.limit\\" must be provided';
      try {
        const data = await controller.queryChannels(<QueryChannelsRequest>{
          pagination: {
            offset: 0,
          } as unknown as PageRequest,
        });
        expect(data).toBe(expectMessage);
      } catch (error) {
        expect(error.message).toContain(expectMessage);
      }
    });
  });

  describe('Test QueryChannel', () => {
    it('QueryChannel should be called successfully', async () => {
      const data = await controller.queryChannel(<QueryChannelRequest>{
        channel_id: 'channel-0',
      });
      expect(data.channel).toMatchObject(queryChannelExpected.channel);
      expect(Buffer.from(data.proof).toString('base64')).toBe(queryChannelExpected.proof);
      expect(data.proof_height).toMatchObject(queryChannelExpected.proof_height);
    });

    it('QueryChannel should be called failed because required parameter `channel_id` was missing.', async () => {
      const expectMessage =
        '{"error":"Invalid argument: \\"channel_id\\" must be provided","type":"string","exceptionName":"RpcException"}';
      try {
        const data = await controller.queryChannel(<QueryChannelRequest>{});
        expect(data).toBe(expectMessage);
      } catch (error) {
        expect(error.message).toBe(expectMessage);
      }
    });

    it('QueryChannel should be called failed because required parameter `channel_id` was missing prefix.', async () => {
      const expectMessage =
        '{"error":"Invalid argument: \\"channel_id\\". Please use the prefix \\"channel-\\"","type":"string","exceptionName":"RpcException"}';
      try {
        const data = await controller.queryChannel(<QueryChannelRequest>{
          channel_id: '0',
        });
        expect(data).toBe(expectMessage);
      } catch (error) {
        expect(error.message).toBe(expectMessage);
      }
    });

    it("QueryChannel should be called failed because it's not found connection id", async () => {
      const expectMessage = 'Unable to find UTxO with unit';
      jest.spyOn(mockLucidService, 'findUtxoByUnit').mockImplementationOnce((unit) => {
        throw new GrpcNotFoundException(`Unable to find UTxO with unit ${unit}`);
      });
      try {
        const data = await controller.queryChannel(<QueryChannelRequest>{
          channel_id: 'channel-6508790',
        });
        expect(data).toContain(expectMessage);
      } catch (error) {
        expect(error.message).toContain(expectMessage);
      }
    });
  });

  describe('Test QueryChannelsConnection', () => {
    it('QueryChannelsConnection should be called successfully', async () => {
      const data = await controller.queryConnectionChannels(<QueryConnectionChannelsRequest>{
        connection: 'connection-0',
        pagination: {
          offset: 0,
          limit: 10,
        } as unknown as PageRequest,
      });
      expect(data).toMatchObject(queryChannelsExpected);
    });
    it("QueryChannelsConnection should be called failed because it's not found channels", async () => {
      jest.spyOn(mockDbService, 'findUtxosByPolicyIdAndPrefixTokenName').mockImplementationOnce(() => {
        return [];
      });
      const expectMessage = {
        channels: [],
        pagination: {
          next_key: null,
          total: 0,
        },
        height: {
          revision_number: 0n,
          revision_height: 0n,
        },
      };
      const data = await controller.queryConnectionChannels(<QueryConnectionChannelsRequest>{
        connection: 'connection-100000',
        pagination: {
          offset: 0,
          limit: 10,
        } as unknown as PageRequest,
      });
      expect(data).toMatchObject(expectMessage);
    });
    it('QueryChannelsConnection should be called failed because required parameter `limit` was missing.', async () => {
      const expectMessage = 'Invalid argument: \\"pagination.limit\\" must be provided';
      try {
        const data = await controller.queryConnectionChannels(<QueryConnectionChannelsRequest>{
          connection: 'connection-0',
          pagination: {
            offset: 0,
          } as unknown as PageRequest,
        });
        expect(data).toBe(expectMessage);
      } catch (error) {
        expect(error.message).toContain(expectMessage);
      }
    });
  });
});
