import {
  Header as HeaderMsg,
  Misbehaviour as MisbehaviourMsg,
} from '@cosmjs-types/src/ibc/lightclients/tendermint/v1/tendermint';
import { Any } from '@cosmjs-types/src/google/protobuf/any';

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
  let clientMessage: ClientMessage = null;

  switch (clientMessageAny.type_url) {
    case '/ibc.lightclients.tendermint.v1.Header': {
      const headerMsg = HeaderMsg.decode(clientMessageAny.value);
      const header = initializeHeader(headerMsg);
      clientMessage = {
        HeaderCase: [header],
      };
      break;
    }
    case '/ibc.lightclients.tendermint.v1.Misbehaviour': {
      const misbehaviourMsg = MisbehaviourMsg.decode(clientMessageAny.value);
      const misbehaviour = initializeMisbehaviour(misbehaviourMsg);
      clientMessage = {
        MisbehaviourCase: [misbehaviour],
      };
      break;
    }
  }

  return clientMessage;
}
