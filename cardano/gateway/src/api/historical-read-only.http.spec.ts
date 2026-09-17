jest.mock('~@/tx/packet.service', () => ({ PacketService: class PacketService {} }));
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiController } from './api.controller';
import { VesseloracleIcqController } from './vesseloracle-icq.controller';
import { ChannelService } from '../query/services/channel.service';
import { PacketService } from '../tx/packet.service';
import { DenomTraceService } from '../query/services/denom-trace.service';
import { CheqdIcqService } from './cheqd-icq.service';
import { VesseloracleIcqService } from './vesseloracle-icq.service';
import { LocalOsmosisSwapPlannerService } from './swap-planner.service';
import { TransferPlannerService } from './transfer-planner.service';
import { BridgeManifestService } from '../query/services/bridge-manifest.service';
import { QueryService } from '../query/services/query.service';
import { HistoricalReadOnlyGuard } from '../security/historical-read-only.guard';

const routes = [
  'transfer', 'packet-history/prune',
  ...['did-doc', 'did-doc-version', 'did-doc-versions-metadata', 'resource', 'resource-metadata',
    'latest-resource-version', 'latest-resource-version-metadata'].map((path) => `icq/cheqd/${path}`),
  'icq/vesseloracle/consolidated-data-report', 'icq/vesseloracle/latest-consolidated-data-report',
];

describe('historical read-only HTTP boundary', () => {
  const original = process.env.GATEWAY_HISTORICAL_READ_ONLY;
  afterEach(() => {
    if (original === undefined) delete process.env.GATEWAY_HISTORICAL_READ_ONLY;
    else process.env.GATEWAY_HISTORICAL_READ_ONLY = original;
  });
  async function start(readOnly: boolean) {
    process.env.GATEWAY_HISTORICAL_READ_ONLY = String(readOnly);
    const build = jest.fn(async () => ({ unsigned_tx: { value: Uint8Array.from([1]) } }));
    const decode = jest.fn(() => ({ historical: true }));
    const module = await Test.createTestingModule({
      controllers: [ApiController, VesseloracleIcqController],
      providers: [HistoricalReadOnlyGuard,
        ...[ChannelService, DenomTraceService, LocalOsmosisSwapPlannerService, TransferPlannerService,
          BridgeManifestService, QueryService].map((provide) => ({ provide, useValue: {} })),
        { provide: PacketService, useValue: { sendPacket: build, prunePacketHistory: build } },
        { provide: CheqdIcqService, useValue: {
          buildDidDocQuery: build, buildDidDocVersionQuery: build, buildAllDidDocVersionsMetadataQuery: build,
          buildResourceQuery: build, buildResourceMetadataQuery: build, buildLatestResourceVersionQuery: build,
          buildLatestResourceVersionMetadataQuery: build, decodeDidDocAcknowledgement: decode,
        } },
        { provide: VesseloracleIcqService, useValue: {
          buildConsolidatedDataReportQuery: build, buildLatestConsolidatedDataReportQuery: build,
          decodeConsolidatedDataReportAcknowledgement: decode,
        } },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    return { app, build, decode };
  }
  it('rejects every HTTP transaction builder before invoking services while leaving historical decoding available', async () => {
    const { app, build, decode } = await start(true);
    try {
      delete process.env.GATEWAY_HISTORICAL_READ_ONLY; // Startup mode cannot be changed mid-flight.
      for (const route of routes) {
        const response = await request(app.getHttpServer()).post(`/api/${route}`).send({});
        expect({ route, status: response.status }).toEqual({ route, status: 503 });
        expect(response.body.message).toContain('historical read-only mode');
      }
      expect(build).not.toHaveBeenCalled();
      for (const route of ['icq/cheqd/did-doc/decode', 'icq/vesseloracle/consolidated-data-report/decode']) {
        await request(app.getHttpServer()).post(`/api/${route}`).send({ acknowledgement_hex: '00' }).expect(200, { historical: true });
      }
      expect(decode).toHaveBeenCalledTimes(2);
    } finally { await app.close(); }
  });
  it('allows the identical transfer route to reach the builder in ordinary mode', async () => {
    const { app, build } = await start(false);
    try {
      await request(app.getHttpServer()).post('/api/transfer').send({}).expect(200);
      expect(build).toHaveBeenCalledTimes(1);
    } finally { await app.close(); }
  });
});
