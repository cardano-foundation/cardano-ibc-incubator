import {
  validateAndFormatConnectionOpenInitParams,
  validateAndFormatConnectionOpenTryParams,
} from '../helper/connection.validate';

describe('connection delay period validation', () => {
  const signer = 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql';
  const counterparty = {
    client_id: '08-cardano-probabilistic-0',
    connection_id: '',
    prefix: { key_prefix: Buffer.from('ibc') },
  };

  it('accepts ConnectionOpenInit when delay_period is zero', () => {
    const result = validateAndFormatConnectionOpenInitParams({
      client_id: '07-tendermint-0',
      counterparty,
      delay_period: 0n,
      signer,
    });

    expect(result.connectionOpenInitOperator.clientId).toBe('0');
  });

  it('preserves ConnectionOpenInit nonzero delay_period', () => {
    const result = validateAndFormatConnectionOpenInitParams({
      client_id: '07-tendermint-0',
      counterparty,
      delay_period: 1n,
      signer,
    });

    expect(result.connectionOpenInitOperator.delayPeriod).toBe(1n);
  });

  it('rejects ConnectionOpenInit when delay_period is negative', () => {
    expect(() =>
      validateAndFormatConnectionOpenInitParams({
        client_id: '07-tendermint-0',
        counterparty,
        delay_period: -1n,
        signer,
      }),
    ).toThrow('delay_period');
  });
});
