import { Test, TestingModule } from '@nestjs/testing';
import { TxController } from '../tx.controller';
import { ClientService } from '../client.service';
import { ConnectionService } from '../connection.service';
import { ChannelService } from '../channel.service';
import { PacketService } from '../packet.service';
import { SubmissionService } from '../submission.service';

describe('TxController - Channel (modern)', () => {
  let controller: TxController;
  let channelServiceMock: {
    channelOpenInit: jest.Mock;
    channelOpenTry: jest.Mock;
    channelOpenAck: jest.Mock;
    channelOpenConfirm: jest.Mock;
    channelCloseInit: jest.Mock;
  };

  beforeEach(async () => {
    // This suite verifies that channel endpoints are pure controller pass-throughs:
    // request in -> matching ChannelService call -> unchanged response out.
    channelServiceMock = {
      channelOpenInit: jest.fn(),
      channelOpenTry: jest.fn(),
      channelOpenAck: jest.fn(),
      channelOpenConfirm: jest.fn(),
      channelCloseInit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TxController],
      providers: [
        { provide: ClientService, useValue: {} },
        { provide: ConnectionService, useValue: {} },
        { provide: ChannelService, useValue: channelServiceMock },
        { provide: PacketService, useValue: {} },
        { provide: SubmissionService, useValue: {} },
      ],
    }).compile();

    controller = module.get<TxController>(TxController);
  });

  it('delegates ChannelOpenInit to ChannelService and returns its response', async () => {
    const request = { signer: 'addr_test1...' } as any;
    const expected = { channel_id: 'channel-0', version: '1.0', unsigned_tx: Buffer.from([1]) } as any;
    channelServiceMock.channelOpenInit.mockResolvedValue(expected);

    const response = await controller.ChannelOpenInit(request);

    expect(channelServiceMock.channelOpenInit).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('propagates ChannelOpenInit errors from ChannelService', async () => {
    // Controller should preserve service-side validation messages.
    const request = { signer: '' } as any;
    channelServiceMock.channelOpenInit.mockRejectedValue(
      new Error('Invalid constructed address: Signer is not valid'),
    );

    await expect(controller.ChannelOpenInit(request)).rejects.toThrow(
      'Invalid constructed address: Signer is not valid',
    );
  });

  it('delegates ChannelOpenTry to ChannelService', async () => {
    // `ChannelChannelOpenTry` is the concrete controller method name.
    const request = { port_id: 'transfer' } as any;
    const expected = { unsigned_tx: Buffer.from([2]) } as any;
    channelServiceMock.channelOpenTry.mockResolvedValue(expected);

    const response = await controller.ChannelChannelOpenTry(request);

    expect(channelServiceMock.channelOpenTry).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates ChannelOpenAck to ChannelService', async () => {
    const request = { channel_id: 'channel-0' } as any;
    const expected = { unsigned_tx: Buffer.from([3]) } as any;
    channelServiceMock.channelOpenAck.mockResolvedValue(expected);

    const response = await controller.ChannelOpenAck(request);

    expect(channelServiceMock.channelOpenAck).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('propagates ChannelOpenAck errors from ChannelService', async () => {
    const request = { channel_id: 'invalid-channel-id' } as any;
    channelServiceMock.channelOpenAck.mockRejectedValue(
      new Error('Invalid argument: "channel_id". Please use the prefix "channel-"'),
    );

    await expect(controller.ChannelOpenAck(request)).rejects.toThrow(
      'Invalid argument: "channel_id". Please use the prefix "channel-"',
    );
  });

  it('delegates ChannelOpenConfirm to ChannelService', async () => {
    const request = { channel_id: 'channel-0' } as any;
    const expected = { unsigned_tx: Buffer.from([4]) } as any;
    channelServiceMock.channelOpenConfirm.mockResolvedValue(expected);

    const response = await controller.ChannelOpenConfirm(request);

    expect(channelServiceMock.channelOpenConfirm).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });
});
