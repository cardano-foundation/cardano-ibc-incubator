import { Test, TestingModule } from '@nestjs/testing';
import { TxService } from './tx.service';

describe('TxService', () => {
  let service: TxService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TxService],
    }).compile();

    service = module.get<TxService>(TxService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
