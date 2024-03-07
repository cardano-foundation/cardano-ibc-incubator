import { Logger, Module } from '@nestjs/common';
import { TxModule } from './tx/tx.module';
import { QueryModule } from './query/query.module';
import DatabaseConfig from './config/database.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import configuration from './config';
import { LucidModule } from './shared/modules/lucid/lucid.module';

@Module({
  imports: [
    // IBCEventWatcherModule,
    // ScheduleModule.forRoot(),
    TypeOrmModule.forRoot(DatabaseConfig),
    // TxModule,
    ConfigModule.forRoot({
      load: [
        configuration,
        () => ({
          deployment: require('./deployment/handler.json'),
        }),
      ],
      isGlobal: true,
    }),
    QueryModule,
    TxModule,
    LucidModule,
  ],
  providers: [Logger],
})
export class AppModule {}