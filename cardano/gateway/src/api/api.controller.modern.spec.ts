import { Test, TestingModule } from '@nestjs/testing';
import { ApiController } from './api.controller';
import { ChannelService } from '~@/query/services/channel.service';
import { PacketService } from '~@/tx/packet.service';
import { MsgTransfer } from '@plus/proto-types/build/ibc/core/channel/v1/tx';

describe('ApiController (modern)', () => {
  let controller: ApiController;
  let channelServiceMock: {
    queryChannels: jest.Mock;
  };
  let packetServiceMock: {
    sendPacket: jest.Mock;
  };

  beforeEach(async () => {
    // API controller tests assert request/response shaping only.
    // Channel/packet services are mocked so external IBC logic is out of scope here.
    channelServiceMock = {
      queryChannels: jest.fn(),
    };
    packetServiceMock = {
      sendPacket: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        { provide: ChannelService, useValue: channelServiceMock },
        { provide: PacketService, useValue: packetServiceMock },
      ],
    }).compile();

    controller = module.get<ApiController>(ApiController);
  });

  it('delegates getChannels to ChannelService and maps pagination/height to strings', async () => {
    // Public API contract uses stringified bigint fields and base64 for bytes.
    channelServiceMock.queryChannels.mockResolvedValue({
      channels: [],
      pagination: { next_key: Buffer.from('next'), total: 10n },
      height: { revision_height: 123n, revision_number: 7n },
    });

    const response = await controller.getChannels('', 0, 50, true, false);

    expect(channelServiceMock.queryChannels).toHaveBeenCalledWith(expect.anything());
    expect(response).toEqual({
      channels: [],
      pagination: {
        next_key: Buffer.from('next').toString('base64'),
        total: '10',
      },
      height: {
        revision_height: '123',
        revision_number: '7',
      },
    });
  });

  it('delegates buildTransferMsg to PacketService and base64-encodes unsigned tx bytes', async () => {
    // DTO -> MsgTransfer mapping should preserve transfer semantics while normalizing output bytes.
    packetServiceMock.sendPacket.mockResolvedValue({
      result: 1,
      unsigned_tx: {
        type_url: '/ibc.core.channel.v1.MsgTransfer',
        value: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      },
    });

    const dto = {
      source_port: 'transfer',
      source_channel: 'channel-0',
      token: { denom: 'stake', amount: '1000' },
      sender: 'cosmos1sender',
      receiver: 'cosmos1receiver',
      timeout_height: { revision_number: '0', revision_height: '0' },
      timeout_timestamp: '0',
      memo: '',
    } as any;

    const response = await controller.buildTransferMsg(dto);

    expect(packetServiceMock.sendPacket).toHaveBeenCalledWith(expect.anything());
    const forwarded = packetServiceMock.sendPacket.mock.calls[0][0] as MsgTransfer;
    expect(forwarded.source_port).toBe('transfer');
    expect(forwarded.source_channel).toBe('channel-0');
    expect(forwarded.token?.denom).toBe('stake');
    expect(response).toEqual({
      result: 1,
      unsigned_tx: {
        type_url: '/ibc.core.channel.v1.MsgTransfer',
        value: Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString('base64'),
      },
    });
  });

  it('propagates buildTransferMsg errors from PacketService', async () => {
    packetServiceMock.sendPacket.mockRejectedValue(new Error('Invalid denom'));

    const dto = {
      source_port: 'transfer',
      source_channel: 'channel-0',
      token: { denom: 'bad-denom', amount: '1' },
      sender: 'cosmos1sender',
      receiver: 'cosmos1receiver',
      timeout_height: { revision_number: '0', revision_height: '0' },
      timeout_timestamp: '0',
      memo: '',
    } as any;

    await expect(controller.buildTransferMsg(dto)).rejects.toThrow('Invalid denom');
  });
});
