import { Test, TestingModule } from '@nestjs/testing';
import { LucidService } from './lucid.service';

describe('LucidService', () => {
  let service: LucidService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LucidService],
    }).compile();

    service = module.get<LucidService>(LucidService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
