import { ClientState as ClientStateOuroboros } from 'cosmjs-types/src/ibc/lightclients/ouroboros/ouroboros';
import { CardanoClientState } from '../types/cardano';
import { convertString2Hex } from './hex';

// Convert client state operator to a structured ClientState object for submit on cardano
export function initializeCardanoClientState(clientStateMsg: ClientStateOuroboros): CardanoClientState {
  // Helper function to convert numbers to BigInt
  const convertToBigInt = (value: any): bigint | null => value;

  const convertCardanoHeight = (height: any): { revision_number: bigint | null; revision_height: bigint | null } => ({
    revision_number: convertToBigInt(height?.revision_number || 0n),
    revision_height: convertToBigInt(height?.revision_height || 0n),
  });

  // Build the client state object
  const clientState: CardanoClientState = {
    chain_id: convertString2Hex(clientStateMsg.chain_id),
    latest_height: convertCardanoHeight(clientStateMsg.latest_height),
    frozen_height: convertCardanoHeight(clientStateMsg.frozen_height),
    valid_after: clientStateMsg.valid_after,
    genesis_time: clientStateMsg.genesis_time,
    current_epoch: clientStateMsg.current_epoch,
    epoch_length: clientStateMsg.epoch_length,
    slot_per_kes_period: clientStateMsg.slot_per_kes_period,
    current_validator_set: clientStateMsg.current_validator_set.map((validator) => {
      return {
        vrf_key_hash: convertString2Hex(validator.vrf_key_hash),
        pool_id: convertString2Hex(validator.pool_id),
      };
    }),
    next_validator_set: clientStateMsg.next_validator_set.map((validator) => {
      return {
        vrf_key_hash: convertString2Hex(validator.vrf_key_hash),
        pool_id: convertString2Hex(validator.pool_id),
      };
    }),
    trusting_period: clientStateMsg.trusting_period,
    upgrade_path: clientStateMsg.upgrade_path,
    token_configs: {
      handler_token_unit: convertString2Hex(clientStateMsg.token_configs?.handler_token_unit),
      client_policy_id: convertString2Hex(clientStateMsg.token_configs?.client_policy_id),
      connection_policy_id: convertString2Hex(clientStateMsg.token_configs?.connection_policy_id),
      channel_policy_id: convertString2Hex(clientStateMsg.token_configs?.channel_policy_id),
    },
  };
  return clientState;
}
