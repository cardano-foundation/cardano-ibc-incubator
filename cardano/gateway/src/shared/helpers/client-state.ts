import { ClientState as ClientStateTendermint } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { bytesFromBase64, toDuration } from '@plus/proto-types/build/helpers';
import { HashOp, LengthOp, hashOpFromJSON, lengthOpFromJSON } from '@plus/proto-types/build/cosmos/ics23/v1/proofs';
import { ClientState } from '../types/client-state-types';
import { convertHex2String, convertString2Hex } from './hex';
import { convertToProofType } from './proof_types';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { KEY_CLIENT_PREFIX, KEY_CLIENT_STATE } from '~@/constant';
import { ClientState as CardanoClientState } from '@plus/proto-types/build/ibc/lightclients/ouroboros/ouroboros';

export function normalizeClientStateFromDatum(clientState: ClientState): ClientStateTendermint {
  const clientStateTendermint: ClientStateTendermint = {
    // On-chain we store `chainId` as bytes (hex) for Plutus data efficiency.
    // For IBC/Tendermint client state over gRPC we must return the plain UTF-8 chain id.
    chain_id: convertHex2String(clientState.chainId),
    trust_level: {
      numerator: clientState.trustLevel.numerator,
      denominator: clientState.trustLevel.denominator,
    },
    /**
     * duration of the period since the LastestTimestamp during which the
     * submitted headers are valid for upgrade
     */
    trusting_period: toDuration(clientState.trustingPeriod.toString()),
    /** duration of the staking unbonding period */
    unbonding_period: toDuration(clientState.unbondingPeriod.toString()),
    /** defines how much new (untrusted) header's Time can drift into the future. */
    max_clock_drift: toDuration(clientState.maxClockDrift.toString()),
    /** Block height when the client was frozen due to a misbehaviour */
    frozen_height: {
      revision_height: clientState.frozenHeight.revisionHeight,
      revision_number: clientState.frozenHeight.revisionNumber,
    },
    /** Latest height the client was updated to */
    latest_height: {
      revision_height: clientState.latestHeight.revisionHeight,
      revision_number: clientState.latestHeight.revisionNumber,
    },
    /** Proof specifications used in verifying counterparty state */
    proof_specs: Array.isArray(clientState.proofSpecs)
      ? clientState.proofSpecs.map((proofSpec) => convertProofSpec(proofSpec))
      : [convertProofSpec(clientState.proofSpecs)],
    /**
     * Path at which next upgraded client will be committed.
     * Each element corresponds to the key for a single CommitmentProof in the
     * chained proof. NOTE: ClientState must stored under
     * `{upgradePath}/{upgradeHeight}/clientState` ConsensusState must be stored
     * under `{upgradepath}/{upgradeHeight}/consensusState` For SDK chains using
     * the default upgrade module, upgrade_path should be []string{"upgrade",
     * "upgradedIBCState"}`
     */
    upgrade_path: [],
    // /** allow_update_after_expiry is deprecated */
    // /** @deprecated */
    // allow_update_after_expiry: boolean;
    // /** allow_update_after_misbehaviour is deprecated */
    // /** @deprecated */
    // allow_update_after_misbehaviour: boolean;
  } as unknown as ClientStateTendermint;

  return clientStateTendermint;
}
// Define the conversion function for proofSpec
function convertProofSpec(proofSpec: any): any {
  const toHashOp = (value: any): HashOp => {
    if (typeof value === 'string') return hashOpFromJSON(value);
    if (typeof value === 'bigint') return Number(value) as HashOp;
    if (typeof value === 'number') return value as HashOp;
    return HashOp.UNRECOGNIZED;
  };

  const toLengthOp = (value: any): LengthOp => {
    if (typeof value === 'string') return lengthOpFromJSON(value);
    if (typeof value === 'bigint') return Number(value) as LengthOp;
    if (typeof value === 'number') return value as LengthOp;
    return LengthOp.UNRECOGNIZED;
  };

  const bytesFromBase64OrHex = (value: any): Uint8Array => {
    if (value instanceof Uint8Array) return value;
    if (typeof value !== 'string') return new Uint8Array();

    const trimmed = value.startsWith('0x') ? value.slice(2) : value;
    const looksLikeHex = trimmed.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(trimmed);
    if (looksLikeHex) {
      return Buffer.from(trimmed, 'hex');
    }

    try {
      return bytesFromBase64(value);
    } catch {
      return new Uint8Array();
    }
  };

  return {
    leaf_spec: {
      hash: toHashOp(proofSpec.leaf_spec.hash),
      prehash_key: toHashOp(proofSpec.leaf_spec.prehash_key),
      prehash_value: toHashOp(proofSpec.leaf_spec.prehash_value),
      length: toLengthOp(proofSpec.leaf_spec.length),
      prefix: bytesFromBase64OrHex(proofSpec.leaf_spec.prefix),
    },
    inner_spec: {
      child_order: proofSpec.inner_spec.child_order.map((e: any) => Number(e)),
      child_size: Number(proofSpec.inner_spec.child_size),
      min_prefix_length: Number(proofSpec.inner_spec.min_prefix_length),
      max_prefix_length: Number(proofSpec.inner_spec.max_prefix_length),
      empty_child: bytesFromBase64OrHex(proofSpec.inner_spec.empty_child),
      hash: toHashOp(proofSpec.inner_spec.hash),
    },
    max_depth: Number(proofSpec.max_depth),
    min_depth: Number(proofSpec.min_depth),
  };
}
// Convert client state operator to a structured ClientState object for submit on cardano
export function initializeClientState(clientStateMsg: ClientStateTendermint): ClientState {
  // Helper function to convert numbers to BigInt
  const convertToBigInt = (value: any): bigint | null => value;

  const convertHeight = (height: any): { revisionNumber: bigint | null; revisionHeight: bigint | null } => ({
    revisionNumber: convertToBigInt(height?.revision_number),
    revisionHeight: convertToBigInt(height?.revision_height),
  });
  // Build the client state object
  const clientState: ClientState = {
    chainId: convertString2Hex(clientStateMsg.chain_id),
    trustLevel: {
      //TODO: remove hardcode 2n
      numerator: convertToBigInt(clientStateMsg.trust_level?.numerator),
      denominator: convertToBigInt(clientStateMsg.trust_level?.denominator),
    },
    trustingPeriod: convertToBigInt(clientStateMsg.trusting_period.seconds * 10n ** 9n),
    unbondingPeriod: convertToBigInt(clientStateMsg.unbonding_period.seconds * 10n ** 9n),
    maxClockDrift: convertToBigInt(clientStateMsg.max_clock_drift.seconds * 10n ** 9n),
    frozenHeight: convertHeight(clientStateMsg.frozen_height),
    latestHeight: convertHeight(clientStateMsg.latest_height),
    proofSpecs: convertToProofType(clientStateMsg.proof_specs),
  };

  return clientState;
}

// Validate the structure and values of the client state
export function validateClientState(clientState: ClientState): GrpcInvalidArgumentException {
  if (clientState.chainId?.length === 0) {
    return new GrpcInvalidArgumentException('chain id cannot be empty string');
  }
  const chainIdUtf8 = convertHex2String(clientState.chainId);
  if (chainIdUtf8?.length > 50) {
    return new GrpcInvalidArgumentException(`chainID is too long; got: ${chainIdUtf8.length}, max: 50`);
  }
  // ValidateTrustLevel checks that trustLevel is within the allowed range [1/3,
  // 1]. If not, it returns an error. 1/3 is the minimum amount of trust needed
  // which does not break the security model.
  if (
    (clientState.trustLevel?.numerator !== null &&
      clientState.trustLevel?.denominator !== null &&
      BigInt(clientState.trustLevel?.numerator) * BigInt(3) < clientState.trustLevel?.denominator) || // < 1/3
    clientState.trustLevel?.numerator > clientState.trustLevel?.denominator || // > 1
    (clientState.trustLevel?.numerator !== null &&
      clientState.trustLevel?.numerator > clientState.trustLevel?.denominator) || // ? This condition seems incorrect. Did you mean denominator?
    clientState.trustLevel?.denominator === null ||
    clientState.trustLevel?.denominator === BigInt(0)
  ) {
    return new GrpcInvalidArgumentException('trustLevel must be within [1/3, 1]');
  }
  if (clientState.trustingPeriod <= 0) {
    return new GrpcInvalidArgumentException('trusting period must be greater than zero');
  }
  if (clientState.unbondingPeriod <= 0) {
    return new GrpcInvalidArgumentException('unbonding period must be greater than zero');
  }
  if (clientState.maxClockDrift <= 0) {
    return new GrpcInvalidArgumentException('max clock drift must be greater than zero');
  }
  // the latest height revision number must match the chain id revision number
  if (chainIdUtf8.includes('-')) {
    // Extract the revision number from the chain ID (e.g., "cheqd-testnet-6" -> "6")
    // The revision number is the last segment after splitting by '-'
    const parts = chainIdUtf8.split('-');
    const chainIdRevision = parts[parts.length - 1];
    const isValidRevisionNumber =
      !chainIdRevision || clientState.latestHeight?.revisionNumber.toString() === chainIdRevision;

    if (!isValidRevisionNumber) {
      throw new GrpcInvalidArgumentException('Latest height revision number must match chain ID revision number');
    }
  }
  if (clientState.latestHeight?.revisionHeight == BigInt(0)) {
    return new GrpcInvalidArgumentException('tendermint clients latest height revision height cannot be zero');
  }
  if (clientState.trustingPeriod >= clientState.unbondingPeriod) {
    return new GrpcInvalidArgumentException(
      `trusting period ${clientState.trustingPeriod} should be < unbonding period ${clientState.unbondingPeriod}`,
    );
  }
  //
  // for (let i = 0; i < clientState.proofSpecs?.length; i++) {
  //   const spec = clientState.proofSpecs[i];
  //   if (spec === null) {
  //     throw new GrpcInvalidArgumentException(`proof spec cannot be null at index: ${i}`);
  //   }
  // }
  //
}

export function isExpired(cs: ClientState, latestTimestamp: bigint, now: bigint): boolean {
  const expirationTime = latestTimestamp + cs.trustingPeriod;
  return expirationTime < now;
}

export function clientStatePath(clientId: string): string {
  return `${KEY_CLIENT_PREFIX}/${clientId}/${KEY_CLIENT_STATE}`;
}

/**
 * Legacy helper for the old Ouroboros/Cardano light client approach.
 *
 * The production Cosmos-side Cardano client is the Mithril client. This function is kept only to
 * avoid losing historical work while the codebase is being consolidated; it is not used by the
 * current Hermes ↔ Gateway relaying flow.
 */
export function getCardanoClientStateForVerifyProofRedeemer(
  cardanoClientState: CardanoClientState,
): CardanoClientState {
  return {
    /** Chain id */
    chain_id: convertHex2String(cardanoClientState.chain_id),
    /** Latest height the client was updated to */
    latest_height: cardanoClientState.latest_height,
    /** Block height when the client was frozen due to a misbehaviour */
    frozen_height: cardanoClientState.frozen_height,
    /** To support finality, this state will be mark as finality after `valid_after` slots, default 0, unit: slot */
    valid_after: cardanoClientState.valid_after,
    /** Time when chain start */
    genesis_time: cardanoClientState.genesis_time,
    /** Epoch number of current chain state */
    current_epoch: cardanoClientState.current_epoch,
    /** Number of slots of this current epoch */
    epoch_length: cardanoClientState.epoch_length,
    /** Number of slots of per KES period */
    slot_per_kes_period: cardanoClientState.slot_per_kes_period,
    /** Current epoch validator set */
    current_validator_set: cardanoClientState.current_validator_set.map((validator) => ({
      /** vrf key hash of pool operator */
      vrf_key_hash: convertHex2String(validator.vrf_key_hash),
      /** pool id of operator */
      pool_id: convertHex2String(validator.pool_id),
    })),
    /** Next epoch validator set */
    next_validator_set: cardanoClientState.next_validator_set.map((validator) => ({
      /** vrf key hash of pool operator */
      vrf_key_hash: convertHex2String(validator.vrf_key_hash),
      /** pool id of operator */
      pool_id: convertHex2String(validator.pool_id),
    })),
    trusting_period: cardanoClientState.trusting_period,
    /** Path at which next upgraded client will be committed. */
    upgrade_path: cardanoClientState.upgrade_path.map((path) => convertHex2String(path)),
    /** IBC related auth token policy configs */
    token_configs: {
      /** IBC handler token uint (policyID + name), in hex format */
      handler_token_unit: convertHex2String(cardanoClientState.token_configs.handler_token_unit),
      /** IBC client token policyID, in hex format */
      client_policy_id: convertHex2String(cardanoClientState.token_configs.client_policy_id),
      /** IBC connection token policyID, in hex format */
      connection_policy_id: convertHex2String(cardanoClientState.token_configs.connection_policy_id),
      /** IBC channel token policyID, in hex format */
      channel_policy_id: convertHex2String(cardanoClientState.token_configs.channel_policy_id),
    },
  };
}
