import {
  Header as HeaderMsg,
  Misbehaviour as MisbehaviourMsg,
} from '@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { Any } from '@cardano-ibc/proto-types/build/google/protobuf/any';

import {
  Misbehaviour,
  decodeMisBehaviour,
  initializeMisbehaviour,
  verifyMisbehaviour,
} from '../misbehaviour/misbehaviour';
import { decodeHeader, Header, initializeHeader, verifyHeader } from '../header';
import { ClientDatum } from '../client-datum';

export type ClientMessage =
  | {
      HeaderCase: Header[];
    }
  | {
      MisbehaviourCase: Misbehaviour[];
    };

export function verifyClientMessage(clientMessage: Any, clientDatum: ClientDatum): boolean {
  switch (clientMessage.type_url) {
    case '/ibc.lightclients.tendermint.v1.Header':
      const headerMsg = decodeHeader(clientMessage.value);
      const header = initializeHeader(headerMsg);

      return verifyHeader(header, clientDatum);
    case '/ibc.lightclients.tendermint.v1.Misbehaviour':
      const misbehaviourMsg = decodeMisBehaviour(clientMessage.value);
      const misbehaviour = initializeMisbehaviour(misbehaviourMsg);
      return verifyMisbehaviour(misbehaviour, clientDatum);
    default:
      return false;
  }
}

export function getClientMessageFromTendermint(clientMessageAny: Any): ClientMessage {
  switch (clientMessageAny.type_url) {
    case '/ibc.lightclients.tendermint.v1.Header': {
      const headerMsg = HeaderMsg.decode(clientMessageAny.value);
      const header = initializeHeader(headerMsg);
      return {
        HeaderCase: [header],
      };
    }
    case '/ibc.lightclients.tendermint.v1.Misbehaviour': {
      const misbehaviourMsg = MisbehaviourMsg.decode(clientMessageAny.value);
      const misbehaviour = initializeMisbehaviour(misbehaviourMsg);
      return {
        MisbehaviourCase: [misbehaviour],
      };
    }
    default:
      throw new Error(`Unsupported Tendermint client message type URL: ${clientMessageAny.type_url}`);
  }
}
