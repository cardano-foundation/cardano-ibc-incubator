import { Test, TestingModule } from '@nestjs/testing';
import { TxController } from '../tx.controller';
import { ClientService } from '../client.service';
import { ConnectionService } from '../connection.service';
import { ChannelService } from '../channel.service';
import { PacketService } from '../packet.service';
import { SubmissionService } from '../submission.service';

describe('TxController - Connection (modern)', () => {
  let controller: TxController;
  let connectionServiceMock: {
    connectionOpenInit: jest.Mock;
    connectionOpenTry: jest.Mock;
    connectionOpenAck: jest.Mock;
    connectionOpenConfirm: jest.Mock;
  };

  beforeEach(async () => {
    // Only the connection service is relevant in this suite; all other services
    // are inert placeholders to keep DI minimal and explicit.
    connectionServiceMock = {
      connectionOpenInit: jest.fn(),
      connectionOpenTry: jest.fn(),
      connectionOpenAck: jest.fn(),
      connectionOpenConfirm: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TxController],
      providers: [
        { provide: ClientService, useValue: {} },
        { provide: ConnectionService, useValue: connectionServiceMock },
        { provide: ChannelService, useValue: {} },
        { provide: PacketService, useValue: {} },
        { provide: SubmissionService, useValue: {} },
      ],
    }).compile();

    controller = module.get<TxController>(TxController);
  });

  it('delegates ConnectionOpenInit to ConnectionService and returns its response', async () => {
    const request = { client_id: '07-tendermint-0' } as any;
    const expected = { unsigned_tx: Buffer.from([1]) } as any;
    connectionServiceMock.connectionOpenInit.mockResolvedValue(expected);

    const response = await controller.ConnectionOpenInit(request);

    expect(connectionServiceMock.connectionOpenInit).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates ConnectionOpenTry to ConnectionService', async () => {
    const request = { client_id: '07-tendermint-0' } as any;
    const expected = { unsigned_tx: Buffer.from([2]) } as any;
    connectionServiceMock.connectionOpenTry.mockResolvedValue(expected);

    const response = await controller.ConnectionOpenTry(request);

    expect(connectionServiceMock.connectionOpenTry).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('delegates ConnectionOpenAck to ConnectionService', async () => {
    const request = { connection_id: 'connection-0' } as any;
    const expected = { unsigned_tx: Buffer.from([3]) } as any;
    connectionServiceMock.connectionOpenAck.mockResolvedValue(expected);

    const response = await controller.ConnectionOpenAck(request);

    expect(connectionServiceMock.connectionOpenAck).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });

  it('propagates ConnectionOpenAck errors from ConnectionService', async () => {
    // We expect raw validation failures to bubble up for caller visibility.
    const request = { connection_id: 'invalid-connection-id' } as any;
    connectionServiceMock.connectionOpenAck.mockRejectedValue(
      new Error('Invalid argument: "connection_id". Please use the prefix "connection-"'),
    );

    await expect(controller.ConnectionOpenAck(request)).rejects.toThrow(
      'Invalid argument: "connection_id". Please use the prefix "connection-"',
    );
  });

  it('delegates ConnectionOpenConfirm to ConnectionService', async () => {
    const request = { connection_id: 'connection-0' } as any;
    const expected = { unsigned_tx: Buffer.from([4]) } as any;
    connectionServiceMock.connectionOpenConfirm.mockResolvedValue(expected);

    const response = await controller.ConnectionOpenConfirm(request);

    expect(connectionServiceMock.connectionOpenConfirm).toHaveBeenCalledWith(request);
    expect(response).toBe(expected);
  });
});
