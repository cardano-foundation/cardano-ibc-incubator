import { MsgCreateClient, MsgUpdateClient } from '@cosmjs-types/src/ibc/core/client/v1/tx';
import { decodeClientState, decodeConsensusState } from './helper';
import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { initializeClientState, validateClientState } from '@shared/helpers/client-state';
import { initializeConsensusState, validateConsensusState } from '@shared/helpers/consensus-state';
import {
  ClientState as ClientStateMsg,
  ConsensusState as ConsensusStateMsg,
} from 'cosmjs-types/src/ibc/lightclients/tendermint/v1/tendermint';
import { ClientState } from '@shared/types/client-state-types';
import { ConsensusState } from '@shared/types/consensus-state';
import { CLIENT_ID_PREFIX } from 'src/constant';

export function validateAndFormatCreateClientParams(data: MsgCreateClient): {
  constructedAddress: string;
  clientState: ClientState;
  consensusState: ConsensusState;
} {
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

  return { constructedAddress, clientId };
}
