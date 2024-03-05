import { Test, TestingModule } from '@nestjs/testing';
import { TxController } from './tx.controller';
import { TxService } from './tx.service';
import { MsgCreateClient, MsgCreateClientResponse } from 'cosmjs-types/ibc/core/client/v1/tx';
describe('TxController', () => {
  let controller: TxController;
  let txService: TxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TxController],
      providers: [TxService], // Add your service to the providers array
    }).compile();

    controller = module.get<TxController>(TxController);
    txService = module.get<TxService>(TxService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('CreateClient', () => {
    it('should call txService.createClient and return the response', async () => {
      // Arrange
      const mockData: MsgCreateClient = {
        signer: null,
        clientState: null,
        consensusState: null,
      };
      const mockResponse: MsgCreateClientResponse = null;
      jest.spyOn(txService, 'createClient').mockResolvedValue(mockResponse);
      // Act
      const result = await controller.CreateClient(mockData);

      // Assert
      expect(result).toBe(mockResponse);
      expect(txService.createClient).toHaveBeenCalledWith(mockData);
    });
  });
});
