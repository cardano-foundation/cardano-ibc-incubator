import { Test, TestingModule } from '@nestjs/testing';
import { TxController } from '../tx.controller';
import { ClientService } from '../client.service';
import { ConnectionService } from '../connection.service';
import { ChannelService } from '../channel.service';
import { PacketService } from '../packet.service';
import { SubmissionService } from '../submission.service';

describe('TxController - Client (modern)', () => {
  let controller: TxController;
  let clientServiceMock: {
    createClient: jest.Mock;
    updateClient: jest.Mock;
  };

  beforeEach(async () => {
    // Keep these tests at the controller boundary: we only assert delegation and
    // error propagation, not client-service business logic.
    clientServiceMock = {
      createClient: jest.fn(),
      updateClient: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TxController],
      providers: [
        { provide: ClientService, useValue: clientServiceMock },
        { provide: ConnectionService, useValue: {} },
        { provide: ChannelService, useValue: {} },
        { provide: PacketService, useValue: {} },
        { provide: SubmissionService, useValue: {} },
      ],
    }).compile();

    controller = module.get<TxController>(TxController);
  });

  it('delegates CreateClient to ClientService and returns its response', async () => {
    const request = { signer: 'addr_test1...' } as any;
    const expected = { client_id: '07-tendermint-0', unsigned_tx: Buffer.from([1, 2, 3]) } as any;
    clientServiceMock.createClient.mockResolvedValue(expected);

    const response = await controller.CreateClient(request);

    expect(clientServiceMock.createClient).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('propagates CreateClient errors from ClientService', async () => {
    // A failed service call must surface as-is so callers can debug the real cause.
    const request = { signer: '' } as any;
    clientServiceMock.createClient.mockRejectedValue(new Error('Invalid constructed address: Signer is not valid'));

    await expect(controller.CreateClient(request)).rejects.toThrow(
      'Invalid constructed address: Signer is not valid',
    );
  });

  it('delegates UpdateClient to ClientService and returns its response', async () => {
    const request = { client_id: '07-tendermint-0' } as any;
    const expected = { unsigned_tx: Buffer.from([4, 5, 6]) } as any;
    clientServiceMock.updateClient.mockResolvedValue(expected);

    const response = await controller.UpdateClient(request);

    expect(clientServiceMock.updateClient).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('propagates UpdateClient errors from ClientService', async () => {
    // Same contract as CreateClient: controller should not swallow or rewrite service errors.
    const request = { client_id: 'invalid-client-id' } as any;
    clientServiceMock.updateClient.mockRejectedValue(
      new Error('Invalid argument: "client_id". Please use the prefix "07-tendermint-"'),
    );

    await expect(controller.UpdateClient(request)).rejects.toThrow(
      'Invalid argument: "client_id". Please use the prefix "07-tendermint-"',
    );
  });
});
