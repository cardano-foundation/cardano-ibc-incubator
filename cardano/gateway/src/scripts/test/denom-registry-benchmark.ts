import * as fs from 'fs';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../../config';
import { loadBridgeConfigFromEnv } from '../../config/bridge-manifest';
import {
  DenomTraceService,
  TraceRegistryBucketGrowthSimulation,
  TraceRegistryBucketStats,
  TraceRegistrySummary,
} from '../../query/services/denom-trace.service';
import { LucidModule } from '../../shared/modules/lucid/lucid.module';

type BenchmarkArgs = {
  bucket?: number;
  simulatedInserts: number;
};

const bridgeConfigFileReader = {
  readFileSync(path: string, _encoding: string) {
    return fs.readFileSync(path, 'utf8');
  },
};

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [
        configuration,
        () => loadBridgeConfigFromEnv(process.env, bridgeConfigFileReader),
      ],
      ignoreEnvFile: true,
      isGlobal: true,
    }),
    LucidModule,
  ],
  providers: [Logger, DenomTraceService],
})
class DenomRegistryBenchmarkModule {}

function parseArgs(argv: string[]): BenchmarkArgs {
  let bucket: number | undefined;
  let simulatedInserts = 256;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--bucket') {
      const raw = argv[index + 1];
      if (!raw) {
        throw new Error('Missing value for --bucket');
      }
      bucket = Number(raw);
      index += 1;
      continue;
    }

    if (arg === '--simulated-inserts') {
      const raw = argv[index + 1];
      if (!raw) {
        throw new Error('Missing value for --simulated-inserts');
      }
      simulatedInserts = Number(raw);
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (bucket !== undefined && (!Number.isInteger(bucket) || bucket < 0 || bucket > 15)) {
    throw new Error(`--bucket must be an integer between 0 and 15, received ${String(bucket)}`);
  }
  if (!Number.isInteger(simulatedInserts) || simulatedInserts < 0) {
    throw new Error(`--simulated-inserts must be a non-negative integer, received ${String(simulatedInserts)}`);
  }

  return { bucket, simulatedInserts };
}

function printUsage(): void {
  console.log(`Usage: npm run benchmark:denom-registry -- [--bucket 0-15] [--simulated-inserts N]

Runs a live on-chain registry summary plus a size-only growth simulation for one bucket.
This mode does not submit voucher-mint transactions; it projects growth using the exact
shard datum encoding and a conservative upper bound of maxTxSize - txHeadroomBytes.`);
}

function selectTargetBucket(summary: TraceRegistrySummary, requestedBucket?: number): TraceRegistryBucketStats {
  if (requestedBucket !== undefined) {
    const explicit = summary.buckets.find((bucket) => bucket.bucketIndex === requestedBucket);
    if (!explicit) {
      throw new Error(`Trace-registry bucket ${requestedBucket} not found`);
    }
    return explicit;
  }

  return [...summary.buckets].sort((left, right) => {
    return (
      right.totalEntries - left.totalEntries ||
      right.activeShardEntryCount - left.activeShardEntryCount ||
      left.bucketIndex - right.bucketIndex
    );
  })[0];
}

function printSummary(summary: TraceRegistrySummary): void {
  console.log('Denom-Registry Benchmark');
  console.log('Mode: size-only projection against live on-chain registry state');
  console.log(
    `Assumption: active shard datum bytes should stay <= maxTxSize - headroom = ${summary.projectedMaxShardDatumBytesUpperBound}`,
  );
  console.log('');
  console.log('Protocol Parameters');
  console.log(`  maxTxSize: ${summary.maxTxSize}`);
  console.log(`  txHeadroomBytes: ${summary.txHeadroomBytes}`);
  console.log('');
  console.log('Current Registry');
  console.log(`  totalEntries: ${summary.totalEntries}`);
  for (const bucket of summary.buckets) {
    console.log(
      `  bucket ${bucket.bucketIndex}: shards=${bucket.shardCount} rollovers=${bucket.rolloverCount} totalEntries=${bucket.totalEntries} activeEntries=${bucket.activeShardEntryCount} activeDatumBytes=${bucket.activeShardDatumBytes}`,
    );
  }
}

function printSimulation(simulation: TraceRegistryBucketGrowthSimulation): void {
  console.log('');
  console.log(`Bucket ${simulation.bucketIndex} Growth Projection`);
  console.log(`  simulatedInserts: ${simulation.simulatedInserts}`);
  console.log(`  initialTotalEntries: ${simulation.initialBucket.totalEntries}`);
  console.log(`  projectedTotalEntries: ${simulation.projectedBucket.totalEntries}`);
  console.log(`  projectedShardCount: ${simulation.projectedBucket.shardCount}`);
  console.log(`  projectedRollovers: ${simulation.projectedRollovers}`);
  console.log(`  projectedActiveShardSequence: ${simulation.projectedBucket.activeShardSequence}`);
  console.log(`  projectedActiveShardEntries: ${simulation.projectedBucket.activeShardEntryCount}`);
  console.log(`  projectedActiveShardDatumBytes: ${simulation.projectedBucket.activeShardDatumBytes}`);
  console.log('');
  console.log('Sample Inserts');
  for (const sample of simulation.sampleInserts) {
    console.log(
      `  #${sample.step}: rollover=${sample.rolledOver ? 'yes' : 'no'} activeShardSequence=${sample.activeShardSequence} activeEntries=${sample.activeShardEntryCount} activeDatumBytes=${sample.activeShardDatumBytes} hash=${sample.voucherHash} denom=${sample.fullDenom}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(DenomRegistryBenchmarkModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const denomTraceService = app.get(DenomTraceService);
    const summary = await denomTraceService.getSummary();
    const targetBucket = selectTargetBucket(summary, args.bucket);
    const simulation = await denomTraceService.simulateBucketGrowth(
      targetBucket.bucketIndex,
      args.simulatedInserts,
    );

    printSummary(summary);
    printSimulation(simulation);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(`Denom-registry benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
