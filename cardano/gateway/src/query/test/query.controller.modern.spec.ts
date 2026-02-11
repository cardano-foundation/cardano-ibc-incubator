import { Test, TestingModule } from '@nestjs/testing';
import { QueryController } from '../query.controller';
import { QueryService } from '../services/query.service';
import { ConnectionService } from '../services/connection.service';
import { ChannelService } from '../services/channel.service';
import { PacketService } from '../services/packet.service';
import { DenomTraceService } from '../services/denom-trace.service';

describe('QueryController (modern)', () => {
  let controller: QueryController;
  let queryServiceMock: Record<string, jest.Mock>;
  let connectionServiceMock: Record<string, jest.Mock>;
  let channelServiceMock: Record<string, jest.Mock>;
  let packetServiceMock: Record<string, jest.Mock>;

  beforeEach(async () => {
    // These are controller-level tests: every downstream service is mocked so we
    // can verify routing/shape behavior without coupling to service internals.
    queryServiceMock = {
      queryClientState: jest.fn(),
      queryConsensusState: jest.fn(),
      queryBlockData: jest.fn(),
      latestHeight: jest.fn(),
      queryNewMithrilClient: jest.fn(),
      queryBlockResults: jest.fn(),
      queryBlockSearch: jest.fn(),
      queryTransactionByHash: jest.fn(),
      queryIBCHeader: jest.fn(),
      queryEvents: jest.fn(),
      queryDenomTrace: jest.fn(),
      queryDenomTraces: jest.fn(),
    };

    connectionServiceMock = {
      queryConnections: jest.fn(),
      queryConnection: jest.fn(),
    };

    channelServiceMock = {
      queryChannels: jest.fn(),
      queryChannel: jest.fn(),
      queryConnectionChannels: jest.fn(),
    };

    packetServiceMock = {
      queryPacketAcknowledgement: jest.fn(),
      queryPacketAcknowledgements: jest.fn(),
      queryPacketCommitment: jest.fn(),
      queryPacketCommitments: jest.fn(),
      queryPacketReceipt: jest.fn(),
      queryUnreceivedPackets: jest.fn(),
      queryUnreceivedAcks: jest.fn(),
      queryProofUnreceivedPackets: jest.fn(),
      queryNextSequenceReceive: jest.fn(),
      QueryNextSequenceAck: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QueryController],
      providers: [
        { provide: QueryService, useValue: queryServiceMock },
        { provide: ConnectionService, useValue: connectionServiceMock },
        { provide: ChannelService, useValue: channelServiceMock },
        { provide: PacketService, useValue: packetServiceMock },
        { provide: DenomTraceService, useValue: {} },
      ],
    }).compile();

    controller = module.get<QueryController>(QueryController);
  });

  // Shared helper that enforces the same contract for each controller endpoint:
  // call the expected service method with the raw request and return service output unchanged.
  async function expectDelegation(
    controllerMethod: string,
    serviceMock: Record<string, jest.Mock>,
    serviceMethod: string,
    request: any,
    expected: any,
  ) {
    serviceMock[serviceMethod].mockResolvedValue(expected);

    const response = await (controller as any)[controllerMethod](request);

    expect(serviceMock[serviceMethod]).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  }

  it('delegates queryClientState to QueryService', async () => {
    await expectDelegation('queryClientState', queryServiceMock, 'queryClientState', { client_id: 'c0' }, { ok: 1 });
  });

  it('delegates queryConsensusState to QueryService', async () => {
    await expectDelegation(
      'queryConsensusState',
      queryServiceMock,
      'queryConsensusState',
      { client_id: 'c0', revision_number: 1n, revision_height: 2n },
      { ok: 1 },
    );
  });

  it('delegates queryBlockData to QueryService', async () => {
    await expectDelegation('queryBlockData', queryServiceMock, 'queryBlockData', { height: 10n }, { ok: 1 });
  });

  it('delegates LatestHeight to QueryService', async () => {
    await expectDelegation('LatestHeight', queryServiceMock, 'latestHeight', {}, { height: 777n });
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

  it('delegates BlockResults to QueryService', async () => {
    await expectDelegation('BlockResults', queryServiceMock, 'queryBlockResults', { height: 10n }, { txs_results: [] });
  });

  it('delegates queryConnections to ConnectionService', async () => {
    await expectDelegation('queryConnections', connectionServiceMock, 'queryConnections', { pagination: {} }, { connections: [] });
  });

  it('delegates queryConnection to ConnectionService', async () => {
    await expectDelegation('queryConnection', connectionServiceMock, 'queryConnection', { connection_id: 'connection-0' }, { connection: {} });
  });

  it('delegates queryChannels to ChannelService', async () => {
    await expectDelegation('queryChannels', channelServiceMock, 'queryChannels', { pagination: {} }, { channels: [] });
  });

  it('delegates queryChannel to ChannelService', async () => {
    await expectDelegation('queryChannel', channelServiceMock, 'queryChannel', { channel_id: 'channel-0' }, { channel: {} });
  });

  it('delegates queryConnectionChannels to ChannelService', async () => {
    await expectDelegation(
      'queryConnectionChannels',
      channelServiceMock,
      'queryConnectionChannels',
      { connection: 'connection-0' },
      { channels: [] },
    );
  });

  it('delegates queryPacketAcknowledgement to PacketService', async () => {
    await expectDelegation(
      'queryPacketAcknowledgement',
      packetServiceMock,
      'queryPacketAcknowledgement',
      { port_id: 'transfer', channel_id: 'channel-0', sequence: 1n },
      { acknowledgement: Buffer.from('ok') },
    );
  });

  it('delegates queryPacketAcknowledgements to PacketService', async () => {
    await expectDelegation(
      'queryPacketAcknowledgements',
      packetServiceMock,
      'queryPacketAcknowledgements',
      { port_id: 'transfer', channel_id: 'channel-0' },
      { acknowledgements: [] },
    );
  });

  it('delegates queryPacketCommitment to PacketService', async () => {
    await expectDelegation(
      'queryPacketCommitment',
      packetServiceMock,
      'queryPacketCommitment',
      { port_id: 'transfer', channel_id: 'channel-0', sequence: 1n },
      { commitment: Buffer.from('c') },
    );
  });

  it('delegates queryPacketCommitments to PacketService', async () => {
    await expectDelegation(
      'queryPacketCommitments',
      packetServiceMock,
      'queryPacketCommitments',
      { port_id: 'transfer', channel_id: 'channel-0' },
      { commitments: [] },
    );
  });

  it('delegates queryPacketReceipt to PacketService', async () => {
    await expectDelegation(
      'queryPacketReceipt',
      packetServiceMock,
      'queryPacketReceipt',
      { port_id: 'transfer', channel_id: 'channel-0', sequence: 1n },
      { received: true },
    );
  });

  it('delegates queryUnreceivedPackets to PacketService', async () => {
    await expectDelegation(
      'queryUnreceivedPackets',
      packetServiceMock,
      'queryUnreceivedPackets',
      { port_id: 'transfer', channel_id: 'channel-0', packet_commitment_sequences: [1n, 2n] },
      { sequences: [2n] },
    );
  });

  it('delegates queryUnreceivedAcknowledgements to PacketService', async () => {
    // Controller method name differs from the PacketService method (`queryUnreceivedAcks`);
    // this test guards that mapping.
    await expectDelegation(
      'queryUnreceivedAcknowledgements',
      packetServiceMock,
      'queryUnreceivedAcks',
      { port_id: 'transfer', channel_id: 'channel-0', packet_ack_sequences: [1n] },
      { sequences: [] },
    );
  });

  it('delegates queryBlockSearch to QueryService', async () => {
    await expectDelegation('queryBlockSearch', queryServiceMock, 'queryBlockSearch', { page: 1n }, { blocks: [] });
  });

  it('delegates queryTransactionByHash to QueryService', async () => {
    await expectDelegation(
      'queryTransactionByHash',
      queryServiceMock,
      'queryTransactionByHash',
      { hash: 'abc123' },
      { tx: {} },
    );
  });

  it('delegates queryProofUnreceivedPackets to PacketService', async () => {
    await expectDelegation(
      'queryProofUnreceivedPackets',
      packetServiceMock,
      'queryProofUnreceivedPackets',
      { port_id: 'transfer', channel_id: 'channel-0', packet_commitment_sequences: [1n] },
      { sequence: 1n, proof: Buffer.from('p') },
    );
  });

  it('delegates queryIBCHeader to QueryService', async () => {
    await expectDelegation(
      'queryIBCHeader',
      queryServiceMock,
      'queryIBCHeader',
      { height: 500n },
      { header: { type_url: '/ibc.lightclients.mithril.v1.MithrilHeader', value: Buffer.from([1]) } },
    );
  });

  it('delegates queryNextSequenceReceive to PacketService', async () => {
    await expectDelegation(
      'queryNextSequenceReceive',
      packetServiceMock,
      'queryNextSequenceReceive',
      { port_id: 'transfer', channel_id: 'channel-0' },
      { next_sequence_receive: 2n },
    );
  });

  it('delegates queryNextSequenceAck to PacketService.QueryNextSequenceAck', async () => {
    await expectDelegation(
      'queryNextSequenceAck',
      packetServiceMock,
      'QueryNextSequenceAck',
      { port_id: 'transfer', channel_id: 'channel-0' },
      { next_sequence_receive: 3n },
    );
  });

  it('delegates queryEvents to QueryService', async () => {
    await expectDelegation('queryEvents', queryServiceMock, 'queryEvents', { key: 'tx.height' }, { events: [] });
  });

  it('delegates denomTrace to QueryService', async () => {
    await expectDelegation(
      'denomTrace',
      queryServiceMock,
      'queryDenomTrace',
      { hash: 'abc123' },
      { denom_trace: { path: 'transfer/channel-0', base_denom: 'stake' } },
    );
  });

  it('delegates denomTraces to QueryService', async () => {
    await expectDelegation(
      'denomTraces',
      queryServiceMock,
      'queryDenomTraces',
      { pagination: {} },
      { denom_traces: [] },
    );
  });
});
