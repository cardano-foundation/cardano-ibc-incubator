import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import {
  CLIENT_ID_PREFIX,
  CONNECTION_ID_PREFIX,
  DEFAULT_FEATURES_VERSION_ORDER_ORDERED,
  DEFAULT_FEATURES_VERSION_ORDER_UNORDERED,
  DEFAULT_IDENTIFIER_VERSION,
} from 'src/constant';
import { MerkleProof as MerkleProofMsg } from '@plus/proto-types/build/ibc/core/commitment/v1/commitment';
import {
  MsgConnectionOpenAck,
  MsgConnectionOpenConfirm,
  MsgConnectionOpenInit,
  MsgConnectionOpenTry,
} from '@plus/proto-types/build/ibc/core/connection/v1/tx';
import { ConnectionOpenInitOperator } from '../dto/connection/connection-open-init-operator.dto';
import { ClientState as ClientStateMsg } from '@plus/proto-types/build/ibc/lightclients/ouroboros/ouroboros';
import { ClientState as ClientStateMithrilMsg } from '@plus/proto-types/build/ibc/lightclients/mithril/mithril';
import { convertString2Hex, toHex } from '@shared/helpers/hex';
import { CardanoClientState } from '@shared/types/cardano';
import { initializeCardanoClientState } from '@shared/helpers/cardano-client';
import { ConnectionOpenTryOperator } from '../dto/connection/connection-open-try-operator.dto';
import { initializeMerkleProof } from '@shared/helpers/merkle-proof';
import { ConnectionOpenAckOperator } from '../dto/connection/connection-open-ack-operator.dto';
import { decodeClientStateMithril, decodeClientStateOuroboros, decodeMerkleProof } from './helper';
import { ConnectionOpenConfirmOperator } from '../dto/connection/connection-open-confirm-operator.dto';
import { MithrilClientState } from '../../shared/types/mithril';
import { initializeMithrilClientState } from '../../shared/helpers/mithril-client';
export function validateAndFormatConnectionOpenInitParams(data: MsgConnectionOpenInit): {
  constructedAddress: string;
  connectionOpenInitOperator: ConnectionOpenInitOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  if (!data.client_id.startsWith(`${CLIENT_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "client_id". Please use the prefix "${CLIENT_ID_PREFIX}-"`,
    );
  const clientSequence: string = data.client_id.replaceAll(`${CLIENT_ID_PREFIX}-`, '');
  // Prepare the connection open init operator object
  const connectionOpenInitOperator: ConnectionOpenInitOperator = {
    clientId: clientSequence,
    versions: [
      {
        identifier: DEFAULT_IDENTIFIER_VERSION,
        features: [DEFAULT_FEATURES_VERSION_ORDER_ORDERED, DEFAULT_FEATURES_VERSION_ORDER_UNORDERED],
      },
    ],
    counterparty: {
      client_id: convertString2Hex(data.counterparty.client_id),
      connection_id: data.counterparty.connection_id || '',
      prefix: {
        key_prefix: toHex(data.counterparty.prefix.key_prefix),
      },
    },
  };
  return { constructedAddress, connectionOpenInitOperator };
}
export function validateAndFormatConnectionOpenTryParams(data: MsgConnectionOpenTry): {
  constructedAddress: string;
  connectionOpenTryOperator: ConnectionOpenTryOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  if (!data.client_id.startsWith(`${CLIENT_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "client_id". Please use the prefix "${CLIENT_ID_PREFIX}-"`,
    );
  const clientSequence: string = data.client_id.replaceAll(`${CLIENT_ID_PREFIX}-`, '');
  const decodedProofInitMsg: MerkleProofMsg = MerkleProofMsg.decode(data.proof_init);
  const decodedProofClientMsg: MerkleProofMsg = MerkleProofMsg.decode(data.proof_client);
  const decodedCardanoClientStateMsg: ClientStateMithrilMsg = ClientStateMithrilMsg.decode(data.client_state.value);
  const clientState: MithrilClientState = initializeMithrilClientState(decodedCardanoClientStateMsg);
  // Prepare the connection open try operator object
  const connectionOpenTryOperator: ConnectionOpenTryOperator = {
    clientId: clientSequence,
    counterparty: {
      client_id: convertString2Hex(data.counterparty.client_id),
      connection_id: convertString2Hex(data.counterparty.connection_id),
      prefix: {
        key_prefix: toHex(data.counterparty.prefix.key_prefix),
      },
    },
    versions: [
      {
        identifier: DEFAULT_IDENTIFIER_VERSION,
        features: [DEFAULT_FEATURES_VERSION_ORDER_ORDERED, DEFAULT_FEATURES_VERSION_ORDER_UNORDERED],
      },
    ],
    counterpartyClientState: clientState,
    proofInit: initializeMerkleProof(decodedProofInitMsg),
    proofClient: initializeMerkleProof(decodedProofClientMsg),
    proofHeight: {
      revisionHeight: BigInt(data.proof_height?.revision_height || 0n),
      revisionNumber: BigInt(data.proof_height?.revision_number || 0n),
    },
  };
  return { constructedAddress, connectionOpenTryOperator };
}
export function validateAndFormatConnectionOpenAckParams(data: MsgConnectionOpenAck): {
  constructedAddress: string;
  connectionOpenAckOperator: ConnectionOpenAckOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  if (!data.connection_id.startsWith(`${CONNECTION_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "connection_id". Please use the prefix "${CONNECTION_ID_PREFIX}-"`,
    );

  const connectionSequence = data.connection_id.replaceAll(`${CONNECTION_ID_PREFIX}-`, '');
  const decodedProofTryMsg: MerkleProofMsg = decodeMerkleProof(data.proof_try);
  const decodedProofClientMsg: MerkleProofMsg = decodeMerkleProof(data.proof_client);
  const decodedMithrilClientStateMsg: ClientStateMithrilMsg = decodeClientStateMithril(data.client_state.value);
  let clientState: MithrilClientState = initializeMithrilClientState(decodedMithrilClientStateMsg);

  // Prepare the connection open ack operator object
  const connectionOpenAckOperator: ConnectionOpenAckOperator = {
    connectionSequence: connectionSequence,
    counterpartyClientState: clientState,
    counterpartyConnectionID: convertString2Hex(data.counterparty_connection_id),
    proofTry: initializeMerkleProof(decodedProofTryMsg),
    proofClient: initializeMerkleProof(decodedProofClientMsg),
    proofHeight: {
      revisionNumber: BigInt(data.proof_height?.revision_number || 0n),
      revisionHeight: BigInt(data.proof_height?.revision_height || 0n),
    },
  };
  return { constructedAddress, connectionOpenAckOperator };
}
export function validateAndFormatConnectionOpenConfirmParams(data: MsgConnectionOpenConfirm): {
  constructedAddress: string;
  connectionOpenConfirmOperator: ConnectionOpenConfirmOperator;
} {
  const constructedAddress: string = data.signer;
  if (!constructedAddress) {
    throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
  }
  if (!data.connection_id.startsWith(`${CONNECTION_ID_PREFIX}-`))
    throw new GrpcInvalidArgumentException(
      `Invalid argument: "connection_id". Please use the prefix "${CONNECTION_ID_PREFIX}-"`,
    );
  const connectionSequence = data.connection_id.replaceAll(`${CONNECTION_ID_PREFIX}-`, '');
  const decodedProofAckMsg: MerkleProofMsg = decodeMerkleProof(data.proof_ack);
  // Prepare the connection open confirm operator object
  const connectionOpenConfirmOperator: ConnectionOpenConfirmOperator = {
    connectionSequence: connectionSequence,
    proofAck: initializeMerkleProof(decodedProofAckMsg),
    proofHeight: {
      revisionNumber: BigInt(data.proof_height?.revision_number || 0n),
      revisionHeight: BigInt(data.proof_height?.revision_height || 0n),
    },
  };
  return { constructedAddress, connectionOpenConfirmOperator };
}
