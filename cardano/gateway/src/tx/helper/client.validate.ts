import {
  MsgCreateClient,
  MsgRecoverClient,
  MsgUpdateClient,
} from '@cardano-ibc/proto-types/build/ibc/core/client/v1/tx';
import { decodeClientState, decodeConsensusState } from './helper';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { initializeClientState, validateClientState } from '@shared/helpers/client-state';
import { initializeConsensusState, validateConsensusState } from '@shared/helpers/consensus-state';
import {
  ClientState as ClientStateMsg,
  ConsensusState as ConsensusStateMsg,
} from '@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { ClientState } from '@shared/types/client-state-types';
import { ConsensusState } from '@shared/types/consensus-state';
import { CLIENT_ID_PREFIX } from 'src/constant';
import { Height } from '@shared/types/height';
import { Any } from '@cardano-ibc/proto-types/build/google/protobuf/any';

export function validateAndFormatCreateClientParams(data: MsgCreateClient): {
  constructedAddress: string;
  clientState: ClientState;
  consensusState: ConsensusState;
} {
  if (!data.client_state) {
    throw new GrpcInvalidArgumentException('Invalid argument: "client_state" is required');
  }
  if (!data.consensus_state) {
    throw new GrpcInvalidArgumentException('Invalid argument: "consensus_state" is required');
  }
  const decodedClientStateMsg: ClientStateMsg = decodeClientState(data.client_state.value);
  const decodedConsensusMsg: ConsensusStateMsg = decodeConsensusState(data.consensus_state.value);
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }

  // Convert input messages to client and consensus state
  const clientState: ClientState = initializeClientState(decodedClientStateMsg);
  const clientStateValidationError = validateClientState(clientState);
  if (clientStateValidationError) {
    throw clientStateValidationError;
  }
  const consensusState: ConsensusState = initializeConsensusState(decodedConsensusMsg);
  const consensusStateValidationError = validateConsensusState(consensusState);
  if (consensusStateValidationError) {
    throw consensusStateValidationError;
  }
  return { constructedAddress, clientState, consensusState };
}
export function validateAndFormatUpdateClientParams(data: MsgUpdateClient): {
  constructedAddress: string;
  clientId: string;
  clientMessage: Any;
} {
  // Validate client ID
  if (!data.client_id) {
    throw new GrpcInvalidArgumentException('Invalid clientId');
  }
  if (!data.client_id.startsWith(`${CLIENT_ID_PREFIX}-`)) {
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "client_id". Please use the prefix "${CLIENT_ID_PREFIX}-"`,
    );
  }
  const clientId: string = data.client_id.replace(`${CLIENT_ID_PREFIX}-`, '');

  // Validate constructed address
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  if (!data.client_message) {
    throw new GrpcInvalidArgumentException('Invalid argument: "client_message" is required');
  }

  return { constructedAddress, clientId, clientMessage: data.client_message };
}

export function validateAndFormatRecoverClientParams(data: MsgRecoverClient): {
  constructedAddress: string;
  subjectClientId: string;
  substituteClientId: string;
} {
  const parseClientId = (value: string, field: string): string => {
    const match = new RegExp(`^${CLIENT_ID_PREFIX}-(0|[1-9][0-9]*)$`).exec(value);
    if (!match) {
      throw new GrpcInvalidArgumentException(
        `Invalid argument: "${field}". Please use the format "${CLIENT_ID_PREFIX}-{sequence}"`,
      );
    }
    return match[1];
  };

  const subjectClientId = parseClientId(data.subject_client_id, 'subject_client_id');
  const substituteClientId = parseClientId(data.substitute_client_id, 'substitute_client_id');
  if (subjectClientId === substituteClientId) {
    throw new GrpcInvalidArgumentException('Subject and substitute clients must be different');
  }
  if (!data.signer?.trim()) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }

  return {
    constructedAddress: data.signer,
    subjectClientId,
    substituteClientId,
  };
}

export function validateUpdateHeaderAdvancesLatestHeight(headerHeight: bigint, latestHeight: Height): void {
  if (headerHeight <= latestHeight.revisionHeight) {
    throw new GrpcInvalidArgumentException(
      `Update header height ${headerHeight} must be greater than client latest height ${latestHeight.revisionHeight}`,
    );
  }
}
