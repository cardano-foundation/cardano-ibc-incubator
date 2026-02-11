import { Test, TestingModule } from '@nestjs/testing';
import { TxController } from '../tx.controller';
import { ClientService } from '../client.service';
import { ConnectionService } from '../connection.service';
import { ChannelService } from '../channel.service';
import { PacketService } from '../packet.service';
import { SubmissionService } from '../submission.service';

describe('TxController - Packet (modern)', () => {
  let controller: TxController;
  let packetServiceMock: {
    recvPacket: jest.Mock;
    sendPacket: jest.Mock;
    acknowledgementPacket: jest.Mock;
    timeoutPacket: jest.Mock;
    timeoutRefresh: jest.Mock;
  };
  let channelServiceMock: {
    channelCloseInit: jest.Mock;
  };

  beforeEach(async () => {
    // Packet endpoints share one controller, but map to two services:
    // PacketService for packet flows and ChannelService for channel close init.
    packetServiceMock = {
      recvPacket: jest.fn(),
      sendPacket: jest.fn(),
      acknowledgementPacket: jest.fn(),
      timeoutPacket: jest.fn(),
      timeoutRefresh: jest.fn(),
    };

    channelServiceMock = {
      channelCloseInit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TxController],
      providers: [
        { provide: ClientService, useValue: {} },
        { provide: ConnectionService, useValue: {} },
        { provide: ChannelService, useValue: channelServiceMock },
        { provide: PacketService, useValue: packetServiceMock },
        { provide: SubmissionService, useValue: {} },
      ],
    }).compile();

    controller = module.get<TxController>(TxController);
  });

  it('delegates RecvPacket to PacketService', async () => {
    const request = { signer: 'addr_test1...' } as any;
    const expected = { unsigned_tx: Buffer.from([1]) } as any;
    packetServiceMock.recvPacket.mockResolvedValue(expected);

    const response = await controller.RecvPacket(request);

    expect(packetServiceMock.recvPacket).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('propagates RecvPacket errors from PacketService', async () => {
    // Error passthrough is intentional: upstream callers need exact failure detail.
    const request = { signer: '' } as any;
    packetServiceMock.recvPacket.mockRejectedValue(new Error('Invalid constructed address: Signer is not valid'));

    await expect(controller.RecvPacket(request)).rejects.toThrow('Invalid constructed address: Signer is not valid');
  });

  it('delegates Transfer to PacketService', async () => {
    const request = { source_port: 'transfer', source_channel: 'channel-0' } as any;
    const expected = { unsigned_tx: Buffer.from([2]) } as any;
    packetServiceMock.sendPacket.mockResolvedValue(expected);

    const response = await controller.Transfer(request);

    expect(packetServiceMock.sendPacket).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates Acknowledgement to PacketService', async () => {
    const request = { packet: { sequence: 1n } } as any;
    const expected = { unsigned_tx: Buffer.from([3]) } as any;
    packetServiceMock.acknowledgementPacket.mockResolvedValue(expected);

    const response = await controller.Acknowledgement(request);

    expect(packetServiceMock.acknowledgementPacket).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates Timeout to PacketService', async () => {
    const request = { packet: { sequence: 2n } } as any;
    const expected = { unsigned_tx: Buffer.from([4]) } as any;
    packetServiceMock.timeoutPacket.mockResolvedValue(expected);

    const response = await controller.Timeout(request);

    expect(packetServiceMock.timeoutPacket).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates TimeoutRefresh to PacketService', async () => {
    const request = { channel_id: 'channel-0' } as any;
    const expected = { unsigned_tx: Buffer.from([5]) } as any;
    packetServiceMock.timeoutRefresh.mockResolvedValue(expected);

    const response = await controller.TimeoutRefresh(request);

    expect(packetServiceMock.timeoutRefresh).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates ChannelCloseInit to ChannelService', async () => {
    const request = { channel_id: 'channel-0' } as any;
    const expected = { unsigned_tx: Buffer.from([6]) } as any;
    channelServiceMock.channelCloseInit.mockResolvedValue(expected);

    const response = await controller.ChannelCloseInit(request);

    expect(channelServiceMock.channelCloseInit).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });
});
