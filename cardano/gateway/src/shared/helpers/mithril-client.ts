import { ClientState as ClientStateOuroboros } from '@plus/proto-types/build/ibc/lightclients/ouroboros/ouroboros';
import { MithrilClientState } from '../types/mithril';
import { convertString2Hex } from './hex';

export function initializeMithrilClientState(clientStateMsg: ClientStateOuroboros): MithrilClientState {
  return {
    chain_id: convertString2Hex(clientStateMsg.chain_id),
    latest_height: {
      mithril_height: clientStateMsg.latest_height.revision_height,
    },
    frozen_height: {
      mithril_height: clientStateMsg.frozen_height.revision_height,
    },
    current_epoch: clientStateMsg.current_epoch,
    trusting_period: clientStateMsg.trusting_period,
    protocol_parameters: {
      k: 5n,
      m: 100n,
      phi_f: 65n,
    },
    upgrade_path: clientStateMsg.upgrade_path,
  };
}
