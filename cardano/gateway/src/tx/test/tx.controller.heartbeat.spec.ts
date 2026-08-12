import { Test, TestingModule } from '@nestjs/testing';

import { ChannelService } from '../channel.service';
import { ClientService } from '../client.service';
import { ConnectionService } from '../connection.service';
import { HostStateHeartbeatService } from '../host-state-heartbeat.service';
import { PacketService } from '../packet.service';
import { SubmissionService } from '../submission.service';
import { TxController } from '../tx.controller';

describe('TxController - HostState heartbeat', () => {
  it('delegates heartbeat construction to HostStateHeartbeatService', async () => {
    const heartbeatService = {
      buildHeartbeat: jest.fn().mockResolvedValue({
        heartbeat_required: false,
        current_epoch: 8,
        host_state_epoch: 8,
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TxController],
      providers: [
        { provide: ClientService, useValue: {} },
        { provide: ConnectionService, useValue: {} },
        { provide: ChannelService, useValue: {} },
        { provide: PacketService, useValue: {} },
        { provide: SubmissionService, useValue: {} },
        { provide: HostStateHeartbeatService, useValue: heartbeatService },
      ],
    }).compile();
    const controller = module.get<TxController>(TxController);
    const request = { signer: 'addr_test1signer' };

    const response = await controller.BuildHostStateHeartbeat(request);

    expect(heartbeatService.buildHeartbeat).toHaveBeenCalledWith(request);
    expect(response.heartbeat_required).toBe(false);
  });
});
