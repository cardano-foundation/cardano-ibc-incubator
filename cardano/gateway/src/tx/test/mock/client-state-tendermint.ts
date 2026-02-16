import { BinaryWriter } from '@plus/proto-types/build/binary';
import { ClientState } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';

class ClientStateTendermintMockBuilder {
  private clientState: ClientState;
  constructor() {
    this.setDefault();
  }
  private reset(): void {
    this.setDefault();
  }
  private setDefault(): void {
    this.clientState = {
      chain_id: 'entrypoint',
      trust_level: { numerator: 1n, denominator: 3n },
      trusting_period: { seconds: 86400n, nanos: 0 },
      unbonding_period: { seconds: 1814400n, nanos: 0 },
      max_clock_drift: { seconds: 600n, nanos: 0 },
      frozen_height: { revision_number: 0n, revision_height: 0n },
      latest_height: { revision_number: 0n, revision_height: 164277n },
      proof_specs: [
        {
          leaf_spec: {
            hash: 1,
            prehash_key: 0,
            prehash_value: 1,
            length: 1,
            prefix: new Uint8Array([0]),
          },
          inner_spec: {
            child_order: [0, 1],
            child_size: 33,
            min_prefix_length: 4,
            max_prefix_length: 12,
            empty_child: new Uint8Array([0]),
            hash: 1,
          },
          max_depth: 0,
          min_depth: 0,
        },
        {
          leaf_spec: {
            hash: 1,
            prehash_key: 0,
            prehash_value: 1,
            length: 1,
            prefix: new Uint8Array([0]),
          },
          inner_spec: {
            child_order: [0, 1],
            child_size: 32,
            min_prefix_length: 1,
            max_prefix_length: 1,
            empty_child: new Uint8Array([0]),
            hash: 1,
          },
          max_depth: 0,
          min_depth: 0,
        },
      ],
      upgrade_path: ['upgrade', 'upgradedIBCState'],
      allow_update_after_expiry: true,
      allow_update_after_misbehaviour: true,
    };
  }
  with_chain_id(chain_id: string): ClientStateTendermintMockBuilder {
    this.clientState.chain_id = chain_id;
    return this;
  }

  with_trust_level(numerator: bigint, denominator: bigint): ClientStateTendermintMockBuilder {
    this.clientState.trust_level = { numerator, denominator };
    return this;
  }

  with_trusting_period(seconds: bigint, nanos: number): ClientStateTendermintMockBuilder {
    this.clientState.trusting_period = { seconds, nanos };
    return this;
  }

  with_unbonding_period(seconds: bigint, nanos: number): ClientStateTendermintMockBuilder {
    this.clientState.unbonding_period = { seconds, nanos };
    return this;
  }

  with_max_clock_drift(seconds: bigint, nanos: number): ClientStateTendermintMockBuilder {
    this.clientState.max_clock_drift = { seconds, nanos };
    return this;
  }

  with_frozen_height(revision_number: bigint, revision_height: bigint): ClientStateTendermintMockBuilder {
    this.clientState.frozen_height = { revision_number, revision_height };
    return this;
  }

  with_latest_height(revision_number: bigint, revision_height: bigint): ClientStateTendermintMockBuilder {
    this.clientState.latest_height = { revision_number, revision_height };
    return this;
  }

  with_proof_specs(proof_specs: any[]): ClientStateTendermintMockBuilder {
    this.clientState.proof_specs = proof_specs;
    return this;
  }

  with_upgrade_path(upgrade_path: string[]): ClientStateTendermintMockBuilder {
    this.clientState.upgrade_path = upgrade_path;
    return this;
  }

  build(): any {
    const builtClientState = { ...this.clientState };
    this.reset();
    return builtClientState;
  }
  encode(): Uint8Array {
    const encoded = ClientState.encode(this.build()).finish();
    this.reset();
    return encoded;
  }
}

const clientStateTendermintMockBuilder = new ClientStateTendermintMockBuilder();

export default clientStateTendermintMockBuilder;
