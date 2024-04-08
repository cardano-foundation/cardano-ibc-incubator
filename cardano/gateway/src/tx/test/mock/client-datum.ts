import { ClientDatum } from '@shared/types/client-datum';
import { ConsensusState } from '@shared/types/consensus-state';
import { ProofSpec } from '@shared/types/proof-specs';

class ClientDatumMockBuilder {
  private clientDatum: ClientDatum;

  constructor() {
    this.setDefault();
  }
  private reset(): void {
    this.setDefault();
  }
  private setDefault(): void {
    this.clientDatum = {
      state: {
        clientState: {
          chainId: '73696465636861696e',
          trustLevel: { numerator: 1n, denominator: 3n },
          trustingPeriod: 86400000000000n,
          unbondingPeriod: 1814400000000000n,
          maxClockDrift: 600000000000n,
          frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
          latestHeight: { revisionNumber: 0n, revisionHeight: 224576n },
          proofSpecs: [
            {
              leaf_spec: {
                hash: 1n,
                prehash_key: 0n,
                prehash_value: 1n,
                length: 1n,
                prefix: '00',
              },
              inner_spec: {
                child_order: [0n, 1n],
                child_size: 33n,
                min_prefix_length: 4n,
                max_prefix_length: 12n,
                empty_child: '',
                hash: 1n,
              },
              max_depth: 0n,
              min_depth: 0n,
              prehash_key_before_comparison: false,
            },
            {
              leaf_spec: {
                hash: 1n,
                prehash_key: 0n,
                prehash_value: 1n,
                length: 1n,
                prefix: '00',
              },
              inner_spec: {
                child_order: [0n, 1n],
                child_size: 32n,
                min_prefix_length: 1n,
                max_prefix_length: 1n,
                empty_child: '',
                hash: 1n,
              },
              max_depth: 0n,
              min_depth: 0n,
              prehash_key_before_comparison: false,
            },
          ],
        },
        consensusStates: new Map([
          [
            { revisionNumber: 0n, revisionHeight: 158468n },
            {
              timestamp: 1711599499024248921n,
              next_validators_hash: '2800ed0dcc0a263ab5e6ede7846ef368dd7e3218d0d749e0965fced0c5294667',
              root: {
                hash: '7cddffb29294833fc977e362d42da7c329e5de8844d0e9cd4c28909cb0e7284c',
              },
            },
          ],
          [
            { revisionNumber: 0n, revisionHeight: 224576n },
            {
              timestamp: 1711599499024248921n,
              next_validators_hash: '2800ed0dcc0a263ab5e6ede7846ef368dd7e3218d0d749e0965fced0c5294667',
              root: {
                hash: '7cddffb29294833fc977e362d42da7c329e5de8844d0e9cd4c28909cb0e7284c',
              },
            },
          ],
        ]),
      },
      token: {
        policyId: 'd8eb6002f13ddcedc0eaea14c1de735ef8bcbd406994e92f8719a78e',
        name: 'ce52cefc337632623d13194c25eb90c346d13c6cf2c9db6436',
      },
    };
  }
  withChainId(chainId: string): ClientDatumMockBuilder {
    this.clientDatum.state.clientState.chainId = chainId;
    return this;
  }

  withTrustLevel(numerator: bigint, denominator: bigint): ClientDatumMockBuilder {
    this.clientDatum.state.clientState.trustLevel = { numerator, denominator };
    return this;
  }

  withTrustingPeriod(trustingPeriod: bigint): ClientDatumMockBuilder {
    this.clientDatum.state.clientState.trustingPeriod = trustingPeriod;
    return this;
  }

  withUnbondingPeriod(unbondingPeriod: bigint): ClientDatumMockBuilder {
    this.clientDatum.state.clientState.unbondingPeriod = unbondingPeriod;
    return this;
  }

  withMaxClockDrift(maxClockDrift: bigint): ClientDatumMockBuilder {
    this.clientDatum.state.clientState.maxClockDrift = maxClockDrift;
    return this;
  }

  withFrozenHeight(revisionNumber: bigint, revisionHeight: bigint): ClientDatumMockBuilder {
    this.clientDatum.state.clientState.frozenHeight = { revisionNumber, revisionHeight };
    return this;
  }

  withLatestHeight(revisionNumber: bigint, revisionHeight: bigint): ClientDatumMockBuilder {
    this.clientDatum.state.clientState.latestHeight = { revisionNumber, revisionHeight };
    return this;
  }

  withProofSpecs(proofSpecs: ProofSpec[]): ClientDatumMockBuilder {
    this.clientDatum.state.clientState.proofSpecs = proofSpecs;
    return this;
  }

  withConsensusState(timestamp: bigint, nextValidatorsHash: string, rootHash: string): ClientDatumMockBuilder {
    const consensusState: ConsensusState = {
      timestamp,
      next_validators_hash: nextValidatorsHash,
      root: { hash: rootHash },
    };
    this.clientDatum.state.consensusStates.set({ revisionNumber: 1n, revisionHeight: 1n }, consensusState);
    return this;
  }

  withAuthToken(policyId: string, name: string): ClientDatumMockBuilder {
    this.clientDatum.token = { policyId, name };
    return this;
  }

  build(): ClientDatum {
    const builtClientDatum = { ...this.clientDatum };
    this.reset();
    return builtClientDatum;
  }
}
const clientDatumMockBuilder = new ClientDatumMockBuilder();
export { clientDatumMockBuilder };
