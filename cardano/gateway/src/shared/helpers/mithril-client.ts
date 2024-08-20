import { ClientState as ClientStateOuroboros } from '@plus/proto-types/build/ibc/lightclients/ouroboros/ouroboros';
import { MithrilClientState } from '../types/mithril';
import { convertHex2String, convertString2Hex, fromText } from './hex';
import { ClientState as ClientStateMithril } from '@plus/proto-types/build/ibc/lightclients/mithril/mithril';

export function initializeMithrilClientState(clientStateMsg: ClientStateMithril): MithrilClientState {
  return {
    /** Chain id */
    chain_id: fromText(clientStateMsg.chain_id),
    /** Latest height the client was updated to */
    latest_height: {
      revisionNumber: clientStateMsg.latest_height.revision_number,
      revisionHeight: clientStateMsg.latest_height.revision_height,
    },
    /** Block height when the client was frozen due to a misbehaviour */
    frozen_height: {
      revisionNumber: clientStateMsg.frozen_height.revision_number,
      revisionHeight: clientStateMsg.frozen_height.revision_height,
    },
    /** Epoch number of current chain state */
    current_epoch: clientStateMsg.current_epoch,
    trusting_period:
      BigInt(clientStateMsg.trusting_period.seconds) * 10n ** 9n + BigInt(clientStateMsg.trusting_period.nanos),
    protocol_parameters: {
      k: clientStateMsg.protocol_parameters.k,
      m: clientStateMsg.protocol_parameters.m,
      phi_f: {
        numerator: clientStateMsg.protocol_parameters.phi_f.numerator,
        denominator: clientStateMsg.protocol_parameters.phi_f.denominator,
      },
    },
    /** Path at which next upgraded client will be committed. */
    upgrade_path: clientStateMsg.upgrade_path,
  };
}

export function getMithrilClientStateForVerifyProofRedeemer(
  mithrilClientState: MithrilClientState,
): ClientStateMithril {
  return {
    chain_id: convertHex2String(mithrilClientState.chain_id),
    latest_height: {
      revision_number: mithrilClientState.latest_height.revisionNumber,
      revision_height: mithrilClientState.latest_height.revisionHeight,
    },
    frozen_height: {
      revision_number: mithrilClientState.frozen_height.revisionNumber,
      revision_height: mithrilClientState.frozen_height.revisionHeight,
    },
    current_epoch: mithrilClientState.current_epoch,
    trusting_period: {
      seconds: mithrilClientState.trusting_period / 10n ** 9n,
      nanos: Number(mithrilClientState.trusting_period % 10n ** 9n),
    },
    protocol_parameters: {
      k: mithrilClientState.protocol_parameters.k,
      m: mithrilClientState.protocol_parameters.m,
      phi_f: {
        numerator: mithrilClientState.protocol_parameters.phi_f.numerator,
        denominator: mithrilClientState.protocol_parameters.phi_f.denominator,
      },
    },
    upgrade_path: mithrilClientState.upgrade_path,
  };
}
