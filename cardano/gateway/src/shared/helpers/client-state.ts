import { ClientState as ClientStateTendermint } from 'cosmjs-types/src/ibc/lightclients/tendermint/v1/tendermint';
import { bytesFromBase64, toDuration } from 'cosmjs-types/src/helpers';
import { hashOpFromJSON, lengthOpFromJSON } from 'cosmjs-types/src/cosmos/ics23/v1/proofs';
import { ClientState } from '../types/client-state-types';

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
