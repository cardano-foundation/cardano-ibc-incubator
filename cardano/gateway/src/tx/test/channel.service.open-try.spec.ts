import { ChannelService } from '../channel.service';

describe('ChannelService channel open try lifecycle', () => {
  it('registers the pending tree update and synthetic channel event with the transaction runner', async () => {
    const unsignedTx = {
      validFrom: jest.fn().mockReturnThis(),
      validTo: jest.fn().mockReturnThis(),
    };
    const pendingTreeUpdate = {
      expectedNewRoot: 'expected-root',
      commit: jest.fn(),
    };
    const txOperationRunnerService = {
      run: jest.fn().mockResolvedValue({ unsignedTxBytes: new Uint8Array([1, 2, 3]) }),
    };
    const service: any = Object.create(ChannelService.prototype);
    service.logger = {
      log: jest.fn(),
      error: jest.fn(),
    };
    service.refreshWalletContext = jest.fn().mockResolvedValue(undefined);
    service.buildUnsignedChannelOpenTryTx = jest.fn().mockResolvedValue({
      unsignedTx,
      channelId: 'channel-1',
      pendingTreeUpdate,
    });
    service.computeTxValidityWindow = jest.fn().mockResolvedValue({
      validFromTime: 1_000,
      validToTime: 2_000,
    });
    service.txOperationRunnerService = txOperationRunnerService;

    const request: any = {
      port_id: 'transfer',
      previous_channel_id: '',
      channel: {
        state: 2,
        ordering: 1,
        counterparty: {
          port_id: 'transfer',
          channel_id: 'channel-77122',
        },
        connection_hops: ['connection-0'],
        version: 'ics20-1',
      },
      counterparty_version: 'ics20-1',
      proof_init: new Uint8Array(),
      proof_height: {
        revision_number: 888n,
        revision_height: 134_471_408n,
      },
      signer: 'addr_test1operator',
    };

    const response = await service.channelOpenTry(request);

    expect(txOperationRunnerService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: 'channelOpenTry',
        unsignedTx,
        pendingTreeUpdate,
        syntheticEvents: [
          {
            type: 'channel_open_try',
            attributes: [
              { key: 'port_id', value: 'transfer' },
              { key: 'channel_id', value: 'channel-1' },
              { key: 'connection_id', value: 'connection-0' },
              { key: 'counterparty_port_id', value: 'transfer' },
              { key: 'counterparty_channel_id', value: 'channel-77122' },
            ],
          },
        ],
      }),
    );
    expect(response.version).toBe('ics20-1');
    expect(response.unsigned_tx?.value).toEqual(new Uint8Array([1, 2, 3]));
  });
});
