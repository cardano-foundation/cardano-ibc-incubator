import { ConsensusState } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';

class ConsensusStateTendermintMockBuilder {
  private consensusState: ConsensusState;

  constructor() {
    this.setDefault();
  }
  private reset(): void {
    this.setDefault();
  }
  private setDefault(): void {
    this.consensusState = {
      timestamp: { seconds: 1711535198n, nanos: 126462531 },
      root: {
        hash: new Uint8Array([
          65, 254, 105, 73, 176, 66, 94, 72, 71, 88, 26, 249, 30, 146, 82, 45, 60, 211, 46, 214, 70, 11, 111, 74, 145,
          0, 246, 241, 188, 80, 224, 193,
        ]),
      },
      next_validators_hash: new Uint8Array([
        40, 0, 237, 13, 204, 10, 38, 58, 181, 230, 237, 231, 132, 110, 243, 104, 221, 126, 50, 24, 208, 215, 73, 224,
        150, 95, 206, 208, 197, 41, 70, 103,
      ]),
    };
  }
  with_timestamp(seconds: bigint, nanos: number): ConsensusStateTendermintMockBuilder {
    this.consensusState.timestamp = { seconds, nanos };
    return this;
  }

  with_root(hash: Uint8Array): ConsensusStateTendermintMockBuilder {
    this.consensusState.root = { hash };
    return this;
  }

  with_next_validators_hash(hash: Uint8Array): ConsensusStateTendermintMockBuilder {
    this.consensusState.next_validators_hash = hash;
    return this;
  }

  build(): any {
    const builtConsensusState = { ...this.consensusState };
    this.reset();
    return builtConsensusState;
  }
  encode(): Uint8Array {
    const encoded = ConsensusState.encode(this.build()).finish();
    this.reset();
    return encoded;
  }
}

const consensusStateTendermintMockBuilder = new ConsensusStateTendermintMockBuilder();

export default consensusStateTendermintMockBuilder;
