import { ConnectionService } from '../connection.service';

jest.mock('../helper/connection.validate', () => ({
  validateAndFormatConnectionOpenTryParams: () => ({ constructedAddress: 'relayer', connectionOpenTryOperator: {} }),
  validateAndFormatConnectionOpenConfirmParams: () => ({
    constructedAddress: 'relayer',
    connectionOpenConfirmOperator: {},
  }),
}));

describe('connection proof transaction validity', () => {
  it.each([
    ['connectionOpenTry', 'buildUnsignedConnectionOpenTryTx'],
    ['connectionOpenConfirm', 'buildUnsignedConnectionOpenConfirmTx'],
  ])('%s supplies both time bounds required by the proof verifier', async (operation, build) => {
    const service = Object.create(ConnectionService.prototype) as any;
    const validity: { from?: number; to?: number } = {};
    const builder = {
      validFrom(time: number) {
        validity.from = time;
        return this;
      },
      validTo(time: number) {
        validity.to = time;
        return this;
      },
    };
    service.logger = { log: jest.fn(), error: jest.fn() };
    service.refreshWalletContext = jest.fn().mockResolvedValue(undefined);
    service.computeTxValidityWindow = jest.fn().mockResolvedValue({ validFromTime: 1000, validToTime: 2000 });
    service[build] = jest.fn().mockResolvedValue({ unsignedTx: builder, connectionId: 'connection-1' });
    service.txOperationRunnerService = {
      run: jest.fn(async (options) => {
        options.validity.apply(options.unsignedTx);
        return { unsignedTxBytes: new Uint8Array([0x84, 0xa0]) };
      }),
    };
    await service[operation]({ client_id: '07-tendermint-1', counterparty: {} });
    expect(validity).toEqual({ from: 1000, to: 2000 });
  });
});
