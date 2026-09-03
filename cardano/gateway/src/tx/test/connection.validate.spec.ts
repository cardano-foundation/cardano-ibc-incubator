import { MsgConnectionOpenAck, MsgConnectionOpenTry } from '@cardano-ibc/proto-types/build/ibc/core/connection/v1/tx';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import {
  validateAndFormatConnectionOpenAckParams,
  validateAndFormatConnectionOpenInitParams,
  validateAndFormatConnectionOpenTryParams,
} from '../helper/connection.validate';

describe('connection client state required fields', () => {
  const signer = 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql';
  const height = { revision_number: 0n, revision_height: 1n };
  const counterparty = {
    client_id: '08-cardano-probabilistic-0',
    connection_id: 'connection-0',
    prefix: { key_prefix: Buffer.from('ibc') },
  };

  it('rejects ConnectionOpenTry without client_state', () => {
    const request: MsgConnectionOpenTry = {
      client_id: '07-tendermint-0',
      previous_connection_id: '',
      counterparty,
      delay_period: 0n,
      counterparty_versions: [],
      proof_height: height,
      proof_init: new Uint8Array(),
      proof_client: new Uint8Array(),
      proof_consensus: new Uint8Array(),
      consensus_height: height,
      signer,
      host_consensus_state_proof: new Uint8Array(),
    };

    const validate = () => validateAndFormatConnectionOpenTryParams(request);
    expect(validate).toThrow(GrpcInvalidArgumentException);
    expect(validate).toThrow('client_state');
  });

  it('rejects ConnectionOpenAck without client_state', () => {
    const request: MsgConnectionOpenAck = {
      connection_id: 'connection-0',
      counterparty_connection_id: 'connection-1',
      proof_height: height,
      proof_try: new Uint8Array(),
      proof_client: new Uint8Array(),
      proof_consensus: new Uint8Array(),
      consensus_height: height,
      signer,
      host_consensus_state_proof: new Uint8Array(),
    };

    const validate = () => validateAndFormatConnectionOpenAckParams(request);
    expect(validate).toThrow(GrpcInvalidArgumentException);
    expect(validate).toThrow('client_state');
  });
});

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
