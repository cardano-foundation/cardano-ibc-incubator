import { MithrilClientState } from '../types/mithril';
import { convertHex2String, fromText } from './hex';
import { ClientState as ClientStateMithril } from '@plus/proto-types/build/ibc/lightclients/mithril/v1/mithril';

export function initializeMithrilClientState(clientStateMsg: ClientStateMithril): MithrilClientState {
  if (!clientStateMsg.latest_height) {
    throw new Error('Invalid Mithril ClientState: latest_height is missing');
  }

  if (!clientStateMsg.trusting_period) {
    throw new Error('Invalid Mithril ClientState: trusting_period is missing');
  }

  if (!clientStateMsg.protocol_parameters) {
    throw new Error('Invalid Mithril ClientState: protocol_parameters is missing');
  }

  if (!clientStateMsg.protocol_parameters.phi_f) {
    throw new Error('Invalid Mithril ClientState: protocol_parameters.phi_f is missing');
  }

  return {
    /** Chain id */
    chain_id: fromText(clientStateMsg.chain_id),
    host_state_nft_policy_id: Buffer.from(clientStateMsg.host_state_nft_policy_id).toString('hex'),
    host_state_nft_token_name: Buffer.from(clientStateMsg.host_state_nft_token_name).toString('hex'),
    /** Latest height the client was updated to */
    latest_height: {
      // Height note:
      // For Mithril, the "height" carried through IBC is not a Cardano slot number.
      // We currently treat `revision_height` as the Mithril transaction snapshot `block_number`
      // (see `QueryLatestHeight` / `QueryNewClient` in the Gateway query service).
      revisionNumber: clientStateMsg.latest_height.revision_number,
      revisionHeight: clientStateMsg.latest_height.revision_height,
    },
    /** Block height when the client was frozen due to a misbehaviour */
    frozen_height: {
      revisionNumber: clientStateMsg.frozen_height?.revision_number ?? 0n,
      revisionHeight: clientStateMsg.frozen_height?.revision_height ?? 0n,
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
  // Encoding detail:
  //
  // The Cosmos chain typically leaves `frozen_height` unset until the client is actually frozen.
  // If we always re-encode it as an "empty" Height (0/0), the protobuf bytes differ by 2 bytes
  // (field tag + length=0). That breaks membership verification where the proof leaf value must
  // match the exact bytes stored on the Cosmos chain.
  const includeFrozenHeight =
    mithrilClientState.frozen_height.revisionNumber !== 0n || mithrilClientState.frozen_height.revisionHeight !== 0n;

  return {
    chain_id: convertHex2String(mithrilClientState.chain_id),
    host_state_nft_policy_id: Buffer.from(mithrilClientState.host_state_nft_policy_id, 'hex'),
    host_state_nft_token_name: Buffer.from(mithrilClientState.host_state_nft_token_name, 'hex'),
    latest_height: {
      revision_number: mithrilClientState.latest_height.revisionNumber,
      revision_height: mithrilClientState.latest_height.revisionHeight,
    },
    frozen_height: includeFrozenHeight
      ? {
          revision_number: mithrilClientState.frozen_height.revisionNumber,
          revision_height: mithrilClientState.frozen_height.revisionHeight,
        }
      : undefined,
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
