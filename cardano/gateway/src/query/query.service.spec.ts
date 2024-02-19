import { Test, TestingModule } from '@nestjs/testing';
import { QueryService } from './query.service';

describe('QueryService', () => {
  let service: QueryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QueryService],
    }).compile();

    service = module.get<QueryService>(QueryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
