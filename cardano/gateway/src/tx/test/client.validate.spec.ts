import { Height } from '@shared/types/height';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import {
  MsgCreateClient,
  MsgRecoverClient,
  MsgUpdateClient,
} from '@cardano-ibc/proto-types/build/ibc/core/client/v1/tx';
import {
  validateAndFormatCreateClientParams,
  validateAndFormatRecoverClientParams,
  validateAndFormatUpdateClientParams,
  validateUpdateHeaderAdvancesLatestHeight,
} from '../helper/client.validate';

describe('client message required fields', () => {
  const signer = 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql';

  it('rejects create client without client_state', () => {
    const request: MsgCreateClient = {
      consensus_state: { type_url: '', value: new Uint8Array() },
      signer,
    };

    const validate = () => validateAndFormatCreateClientParams(request);
    expect(validate).toThrow(GrpcInvalidArgumentException);
    expect(validate).toThrow('client_state');
  });

  it('rejects create client without consensus_state', () => {
    const request: MsgCreateClient = {
      client_state: { type_url: '', value: new Uint8Array() },
      signer,
    };

    const validate = () => validateAndFormatCreateClientParams(request);
    expect(validate).toThrow(GrpcInvalidArgumentException);
    expect(validate).toThrow('consensus_state');
  });

  it('rejects update client without client_message', () => {
    const request: MsgUpdateClient = {
      client_id: '07-tendermint-0',
      signer,
    };

    const validate = () => validateAndFormatUpdateClientParams(request);
    expect(validate).toThrow(GrpcInvalidArgumentException);
    expect(validate).toThrow('client_message');
  });

  it('formats distinct canonical recovery client IDs', () => {
    const request: MsgRecoverClient = {
      subject_client_id: '07-tendermint-12',
      substitute_client_id: '07-tendermint-13',
      signer,
    };

    expect(validateAndFormatRecoverClientParams(request)).toEqual({
      constructedAddress: signer,
      subjectClientId: '12',
      substituteClientId: '13',
    });
  });

  it('rejects recovery with the same subject and substitute', () => {
    const request: MsgRecoverClient = {
      subject_client_id: '07-tendermint-12',
      substitute_client_id: '07-tendermint-12',
      signer,
    };

    expect(() => validateAndFormatRecoverClientParams(request)).toThrow(
      'Subject and substitute clients must be different',
    );
  });

  it('rejects a non-canonical recovery client ID', () => {
    const request: MsgRecoverClient = {
      subject_client_id: '07-tendermint-01',
      substitute_client_id: '07-tendermint-2',
      signer,
    };

    expect(() => validateAndFormatRecoverClientParams(request)).toThrow('subject_client_id');
  });
});

describe('update client header height validation', () => {
  const latestHeight: Height = {
    revisionNumber: 0n,
    revisionHeight: 100n,
  };

  it('accepts a header above the latest client height', () => {
    expect(() => validateUpdateHeaderAdvancesLatestHeight(101n, latestHeight)).not.toThrow();
  });

  it('rejects a header at the latest client height', () => {
    expect(() => validateUpdateHeaderAdvancesLatestHeight(100n, latestHeight)).toThrow(GrpcInvalidArgumentException);
  });

  it('rejects a historical header below the latest client height', () => {
    expect(() => validateUpdateHeaderAdvancesLatestHeight(99n, latestHeight)).toThrow(
      'must be greater than client latest height',
    );
  });
});
