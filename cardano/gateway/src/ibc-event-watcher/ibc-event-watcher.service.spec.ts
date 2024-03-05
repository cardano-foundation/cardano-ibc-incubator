import { Test, TestingModule } from '@nestjs/testing';
import { IBCEventWatcherService } from './ibc-event-watcher.service';


describe('IBCEventWatcherService', () => {
  let service: IBCEventWatcherService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IBCEventWatcherService],
    }).compile();

    service = module.get<IBCEventWatcherService>(IBCEventWatcherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
