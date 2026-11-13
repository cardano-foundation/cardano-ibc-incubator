import { State } from '../../shared/types/connection/state';
import { encodeConnectionEndValue } from '../../shared/types/connection/connection-datum';
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

jest.mock('../../shared/types/connection/connection-datum', () => ({
  encodeConnectionEndValue: jest.fn().mockResolvedValue('00'),
}));

describe('connection CONFIRM state', () => {
  it.each([State.TryOpen, State.Init, State.Open, State.Uninitialized])(
    'checks %s before building the update',
    async (state) => {
      const service = Object.create(ConnectionService.prototype) as any;
      const hex = (value: string) => Buffer.from(value).toString('hex');
      service.lucidService = {
        findUtxoAtHostStateNFT: jest.fn().mockResolvedValue({ datum: 'host' }),
        getConnectionTokenUnit: jest.fn().mockReturnValue(['policy', 'token']),
        findUtxoByUnit: jest.fn().mockResolvedValue({ datum: 'connection' }),
        decodeDatum: jest.fn().mockImplementation(async (_datum, kind) =>
          kind === 'host_state'
            ? { state: { ibc_state_root: 'root' } }
            : {
                state: {
                  state,
                  client_id: hex('07-tendermint-1'),
                  counterparty: {
                    client_id: hex('08-cardano-probabilistic-1'),
                    connection_id: hex('connection-0'),
                  },
                },
              },
        ),
      };
      service.ensureTreeAligned = jest.fn();
      const reachedUpdate = new Error('reached tree update');
      service.computeRootWithCreateConnectionUpdate = jest.fn(() => {
        throw reachedUpdate;
      });
      const build = service.buildUnsignedConnectionOpenConfirmTx({ connectionSequence: 1 }, 'relayer');
      if (state === State.TryOpen) {
        await expect(build).rejects.toBe(reachedUpdate);
        expect(encodeConnectionEndValue).toHaveBeenLastCalledWith(
          expect.objectContaining({ state: State.Open }),
          undefined,
        );
      } else {
        await expect(build).rejects.toThrow('ConnOpenConfirm requires a connection in TryOpen state');
        expect(service.computeRootWithCreateConnectionUpdate).not.toHaveBeenCalled();
      }
    },
  );
});
