import { Logger, Module } from '@nestjs/common';
import { TxModule } from './tx/tx.module';
import { QueryModule } from './query/query.module';
import { HistoryDatabaseConfig } from './config/history-database.config';
import { GatewayDatabaseConfig } from './config/gateway-database.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import configuration from './config';
import { LucidModule } from './shared/modules/lucid/lucid.module';
import { KupoModule } from './shared/modules/kupo/kupo.module';
import { ApiModule } from './api/api.module';
import { MithrilModule } from './shared/modules/mithril/mithril.module';
import { TreeInitService } from './shared/services/tree-init.service';
import { HealthModule } from './health/health.module';
import {
  loadBridgeConfigFromEnv,
} from './config/bridge-manifest';

@Module({
  imports: [
    TypeOrmModule.forRoot(HistoryDatabaseConfig),
    TypeOrmModule.forRoot(GatewayDatabaseConfig),
    ConfigModule.forRoot({
      load: [
        configuration,
        () => {
          const fs = require('fs');
          return loadBridgeConfigFromEnv(process.env, fs);
        },
      ],
      isGlobal: true,
    }),
    HealthModule,
    QueryModule,
    TxModule,
    LucidModule,
    KupoModule,
    ApiModule,
    MithrilModule,
  ],
  providers: [Logger, TreeInitService],
})
export class AppModule {}
