import { ClientState as ClientStateTendermint } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { bytesFromBase64, toDuration } from '@plus/proto-types/build/helpers';
import { hashOpFromJSON, lengthOpFromJSON } from '@plus/proto-types/build/cosmos/ics23/v1/proofs';
import { ClientState } from '../types/client-state-types';
import { convertHex2String, convertString2Hex } from './hex';
import { convertToProofType } from './proof_types';
import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
export function normalizeClientStateFromDatum(clientState: ClientState): ClientStateTendermint {
  const clientStateTendermint: ClientStateTendermint = {
    chain_id: clientState.chainId,
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
  return {
    leaf_spec: {
      hash: hashOpFromJSON(proofSpec.leaf_spec.hash),
      prehash_key: hashOpFromJSON(proofSpec.leaf_spec.prehash_key),
      prehash_value: hashOpFromJSON(proofSpec.leaf_spec.prehash_value),
      length: lengthOpFromJSON(proofSpec.leaf_spec.length),
      prefix: bytesFromBase64(proofSpec.leaf_spec.prefix),
    },
    inner_spec: {
      child_order: proofSpec.inner_spec.child_order.map((e: any) => Number(e)),
      child_size: Number(proofSpec.inner_spec.child_size),
      min_prefix_length: Number(proofSpec.inner_spec.min_prefix_length),
      max_prefix_length: Number(proofSpec.inner_spec.max_prefix_length),
      empty_child: bytesFromBase64(proofSpec.inner_spec.empty_child),
      hash: hashOpFromJSON(proofSpec.inner_spec.hash),
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
    const [_, chainIdRevision] = chainIdUtf8?.split('-');
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
