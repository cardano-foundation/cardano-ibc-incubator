import { Test, TestingModule } from '@nestjs/testing';
import { QueryController } from '../query.controller';
import { QueryService } from '../services/query.service';
import { ConnectionService } from '../services/connection.service';
import { ChannelService } from '../services/channel.service';
import { PacketService } from '../services/packet.service';
import { DenomTraceService } from '../services/denom-trace.service';

describe('QueryController (modern)', () => {
  let controller: QueryController;
  let queryServiceMock: {
    queryNewMithrilClient: jest.Mock;
    queryIBCHeader: jest.Mock;
    queryDenomTrace: jest.Mock;
    latestHeight: jest.Mock;
  };
  let connectionServiceMock: {
    queryConnections: jest.Mock;
  };
  let packetServiceMock: {
    queryPacketAcknowledgement: jest.Mock;
  };

  beforeEach(async () => {
    queryServiceMock = {
      queryNewMithrilClient: jest.fn(),
      queryIBCHeader: jest.fn(),
      queryDenomTrace: jest.fn(),
      latestHeight: jest.fn(),
    };

    connectionServiceMock = {
      queryConnections: jest.fn(),
    };

    packetServiceMock = {
      queryPacketAcknowledgement: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QueryController],
      providers: [
        { provide: QueryService, useValue: queryServiceMock },
        { provide: ConnectionService, useValue: connectionServiceMock },
        { provide: ChannelService, useValue: {} },
        { provide: PacketService, useValue: packetServiceMock },
        { provide: DenomTraceService, useValue: {} },
      ],
    }).compile();

    controller = module.get<QueryController>(QueryController);
  });

  it('delegates NewClient to QueryService and returns its response', async () => {
    const request = { height: 123n } as any;
    const expected = {
      client_state: { type_url: '/ibc.lightclients.mithril.v1.ClientState', value: Buffer.from('01', 'hex') },
      consensus_state: { type_url: '/ibc.lightclients.mithril.v1.ConsensusState', value: Buffer.from('02', 'hex') },
    } as any;
    queryServiceMock.queryNewMithrilClient.mockResolvedValue(expected);

    const response = await controller.NewClient(request);

    expect(queryServiceMock.queryNewMithrilClient).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('propagates NewClient errors from QueryService', async () => {
    const request = { height: 999n } as any;
    queryServiceMock.queryNewMithrilClient.mockRejectedValue(new Error('Not found: "height" 999 not found'));

    await expect(controller.NewClient(request)).rejects.toThrow('Not found: "height" 999 not found');
  });

  it('delegates queryIBCHeader to QueryService', async () => {
    const request = { height: 500n } as any;
    const expected = { header: { type_url: '/ibc.lightclients.mithril.v1.MithrilHeader', value: Buffer.from([1]) } } as any;
    queryServiceMock.queryIBCHeader.mockResolvedValue(expected);

    const response = await controller.queryIBCHeader(request);

    expect(queryServiceMock.queryIBCHeader).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates denomTrace to QueryService', async () => {
    const request = { hash: 'abc123' } as any;
    const expected = { denom_trace: { path: 'transfer/channel-0', base_denom: 'stake' } } as any;
    queryServiceMock.queryDenomTrace.mockResolvedValue(expected);

    const response = await controller.denomTrace(request);

    expect(queryServiceMock.queryDenomTrace).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates queryConnections to ConnectionService', async () => {
    const request = { pagination: { offset: 0, limit: 10 } } as any;
    const expected = { connections: [] } as any;
    connectionServiceMock.queryConnections.mockResolvedValue(expected);

    const response = await controller.queryConnections(request);

    expect(connectionServiceMock.queryConnections).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates queryPacketAcknowledgement to PacketService', async () => {
    const request = { port_id: 'transfer', channel_id: 'channel-0', sequence: 1n } as any;
    const expected = { acknowledgement: Buffer.from('ok') } as any;
    packetServiceMock.queryPacketAcknowledgement.mockResolvedValue(expected);

    const response = await controller.queryPacketAcknowledgement(request);

    expect(packetServiceMock.queryPacketAcknowledgement).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates LatestHeight to QueryService', async () => {
    const request = {} as any;
    const expected = { height: 777n } as any;
    queryServiceMock.latestHeight.mockResolvedValue(expected);

    const response = await controller.LatestHeight(request);

    expect(queryServiceMock.latestHeight).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });
});
