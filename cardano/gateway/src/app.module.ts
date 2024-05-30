import { Logger, Module } from '@nestjs/common';
import { TxModule } from './tx/tx.module';
import { QueryModule } from './query/query.module';
import DatabaseConfig from './config/database.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import configuration from './config';
import { LucidModule } from './shared/modules/lucid/lucid.module';
import { MiniProtocalsModule } from './shared/modules/mini-protocals/mini-protocals.module';
import { MithrilModule } from './shared/modules/mithril/mithril.module';

@Module({
  imports: [
    // IBCEventWatcherModule,
    // ScheduleModule.forRoot(),
    TypeOrmModule.forRoot(DatabaseConfig),
    TypeOrmModule.forRoot({
      name: 'cardano_transaction',
      type: 'sqlite',
      database: './../../chains/mithrils/data/aggregator/stores/cardano-transaction.sqlite3',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
      logging: true,
    }),
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
    MiniProtocalsModule,
    MithrilModule,
  ],
  providers: [Logger],
})
export class AppModule {}
