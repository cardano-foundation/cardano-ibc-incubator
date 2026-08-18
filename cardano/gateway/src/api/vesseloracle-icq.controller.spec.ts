import { ApiModule } from './api.module';
import { VesseloracleIcqController } from './vesseloracle-icq.controller';
import { VesseloracleIcqService } from './vesseloracle-icq.service';

describe('VesseloracleIcqController preservation', () => {
  it('remains absent from the active Gateway module', () => {
    const controllers = (Reflect.getMetadata('controllers', ApiModule) ?? []) as unknown[];
    const providers = (Reflect.getMetadata('providers', ApiModule) ?? []) as unknown[];

    expect(controllers).not.toContain(VesseloracleIcqController);
    expect(providers).not.toContain(VesseloracleIcqService);
  });

  it('retains the unsigned transaction response shape for later activation', async () => {
    const service = {
      buildConsolidatedDataReportQuery: jest.fn().mockResolvedValue({
        query_path: '/vesseloracle.vesseloracle.Query/ConsolidatedDataReport',
        source_port: 'icqhost',
        source_channel: 'channel-7',
        packet_sequence: '9',
        packet_data_hex: 'c0ffee',
        tx: {
          result: 1,
          unsigned_tx: {
            type_url: '/ibc.core.channel.v1.MsgTransfer',
            value: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]),
          },
        },
      }),
    };
    const controller = new VesseloracleIcqController(service as unknown as VesseloracleIcqService);

    await expect(
      controller.buildConsolidatedDataReport({
        source_channel: 'channel-7',
        signer: 'addr_test1qpz...',
        imo: '9525338',
        ts: '1713110400',
      }),
    ).resolves.toEqual({
      query_path: '/vesseloracle.vesseloracle.Query/ConsolidatedDataReport',
      source_port: 'icqhost',
      source_channel: 'channel-7',
      packet_sequence: '9',
      packet_data_hex: 'c0ffee',
      result: 1,
      unsigned_tx: {
        type_url: '/ibc.core.channel.v1.MsgTransfer',
        value: '3q2+7w==',
      },
    });
  });
});
