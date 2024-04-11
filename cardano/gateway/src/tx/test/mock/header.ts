import { Header } from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';

class HeaderMockBuilder {
  private headerMock: Header;

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.headerMock = {
      signed_header: {
        header: {
          version: { block: 11n, app: 0n },
          chain_id: 'sidechain',
          height: 158477n,
          time: { seconds: 1711685790n, nanos: 941264372 },
          last_block_id: {
            hash: new Uint8Array([
              11, 225, 34, 116, 31, 140, 245, 11, 212, 137, 28, 15, 163, 102, 238, 43, 8, 220, 95, 59, 95, 191, 167,
              129, 155, 29, 58, 13, 103, 220, 25, 125,
            ]),
            part_set_header: {
              total: 1,
              hash: new Uint8Array([
                169, 1, 155, 38, 80, 184, 2, 73, 172, 60, 180, 77, 25, 124, 48, 153, 0, 4, 85, 165, 128, 175, 65, 231,
                240, 97, 74, 63, 207, 93, 50, 157,
              ]),
            },
          },
          last_commit_hash: new Uint8Array([
            33, 218, 163, 47, 11, 213, 250, 228, 203, 30, 11, 255, 123, 122, 139, 132, 88, 76, 37, 107, 214, 249, 129,
            53, 118, 88, 220, 70, 190, 189, 101, 187,
          ]),
          data_hash: new Uint8Array([
            167, 165, 170, 178, 152, 139, 114, 52, 177, 147, 222, 255, 140, 84, 233, 104, 131, 14, 253, 97, 41, 47, 159,
            230, 219, 141, 150, 135, 178, 205, 98, 78,
          ]),
          validators_hash: new Uint8Array([
            197, 18, 13, 133, 141, 163, 224, 14, 197, 135, 238, 138, 76, 147, 203, 15, 86, 165, 10, 224, 9, 81, 221,
            139, 20, 132, 84, 152, 58, 226, 185, 149,
          ]),
          next_validators_hash: Buffer.from('2800ed0dcc0a263ab5e6ede7846ef368dd7e3218d0d749e0965fced0c5294667', 'hex'),
          consensus_hash: new Uint8Array([
            4, 128, 145, 188, 125, 220, 40, 63, 119, 191, 191, 145, 215, 60, 68, 218, 88, 195, 223, 138, 156, 188, 134,
            116, 5, 216, 183, 243, 218, 173, 162, 47,
          ]),
          app_hash: new Uint8Array([
            106, 121, 157, 253, 41, 11, 112, 117, 207, 1, 228, 178, 4, 52, 192, 47, 54, 152, 91, 27, 216, 164, 74, 186,
            152, 104, 57, 138, 160, 72, 190, 16,
          ]),
          last_results_hash: new Uint8Array([
            227, 176, 196, 66, 152, 252, 28, 20, 154, 251, 244, 200, 153, 111, 185, 36, 39, 174, 65, 228, 100, 155, 147,
            76, 164, 149, 153, 27, 120, 82, 184, 85,
          ]),
          evidence_hash: new Uint8Array([
            227, 176, 196, 66, 152, 252, 28, 20, 154, 251, 244, 200, 153, 111, 185, 36, 39, 174, 65, 228, 100, 155, 147,
            76, 164, 149, 153, 27, 120, 82, 184, 85,
          ]),
          proposer_address: new Uint8Array([
            149, 37, 195, 32, 47, 28, 160, 208, 116, 32, 107, 179, 179, 48, 73, 47, 64, 232, 6, 92,
          ]),
        },
        commit: {
          height: 158477n,
          round: 0,
          block_id: {
            hash: new Uint8Array([
              161, 240, 103, 57, 122, 162, 69, 29, 145, 39, 41, 123, 250, 62, 132, 95, 3, 87, 77, 116, 21, 163, 114,
              126, 229, 143, 166, 40, 187, 217, 149, 206,
            ]),
            part_set_header: {
              total: 1,
              hash: new Uint8Array([
                174, 204, 241, 136, 108, 27, 151, 170, 255, 255, 101, 97, 168, 90, 246, 124, 159, 185, 35, 128, 253,
                103, 74, 21, 255, 221, 84, 45, 222, 191, 131, 8,
              ]),
            },
          },
          signatures: [
            {
              block_id_flag: 2,
              validator_address: new Uint8Array([
                149, 37, 195, 32, 47, 28, 160, 208, 116, 32, 107, 179, 179, 48, 73, 47, 64, 232, 6, 92,
              ]),
              timestamp: { seconds: 1711859207n, nanos: 978256852 },
              signature: new Uint8Array([
                167, 145, 133, 84, 156, 104, 229, 135, 195, 231, 98, 64, 114, 223, 56, 201, 24, 225, 18, 154, 62, 199,
                78, 171, 183, 220, 49, 179, 80, 217, 127, 71, 254, 235, 46, 174, 225, 233, 87, 103, 152, 14, 246, 172,
                129, 227, 175, 5, 216, 168, 197, 126, 64, 13, 83, 62, 50, 30, 7, 148, 67, 27, 104, 14,
              ]),
            },
          ],
        },
      },
      validator_set: {
        validators: [
          {
            address: new Uint8Array([
              149, 37, 195, 32, 47, 28, 160, 208, 116, 32, 107, 179, 179, 48, 73, 47, 64, 232, 6, 92,
            ]),
            pub_key: {
              ed25519: new Uint8Array([
                181, 198, 87, 163, 250, 185, 14, 112, 100, 245, 108, 116, 128, 65, 129, 234, 87, 156, 220, 9, 35, 156,
                42, 48, 92, 5, 187, 241, 18, 241, 75, 119,
              ]),
              secp256k1: undefined,
            },
            voting_power: 10n,
            proposer_priority: 0n,
          },
        ],
        proposer: {
          address: new Uint8Array([
            149, 37, 195, 32, 47, 28, 160, 208, 116, 32, 107, 179, 179, 48, 73, 47, 64, 232, 6, 92,
          ]),
          pub_key: {
            ed25519: new Uint8Array([
              181, 198, 87, 163, 250, 185, 14, 112, 100, 245, 108, 116, 128, 65, 129, 234, 87, 156, 220, 9, 35, 156, 42,
              48, 92, 5, 187, 241, 18, 241, 75, 119,
            ]),
            secp256k1: undefined,
          },
          voting_power: 10n,
          proposer_priority: 0n,
        },
        total_voting_power: 0n,
      },
      trusted_height: { revision_number: 0n, revision_height: 158468n }, //158477n
      trusted_validators: {
        validators: [
          {
            address: new Uint8Array([
              149, 37, 195, 32, 47, 28, 160, 208, 116, 32, 107, 179, 179, 48, 73, 47, 64, 232, 6, 92,
            ]),
            pub_key: {
              ed25519: new Uint8Array([
                181, 198, 87, 163, 250, 185, 14, 112, 100, 245, 108, 116, 128, 65, 129, 234, 87, 156, 220, 9, 35, 156,
                42, 48, 92, 5, 187, 241, 18, 241, 75, 119,
              ]),
              secp256k1: undefined,
            },
            voting_power: 10n,
            proposer_priority: 0n,
          },
        ],
        proposer: {
          address: new Uint8Array([
            149, 37, 195, 32, 47, 28, 160, 208, 116, 32, 107, 179, 179, 48, 73, 47, 64, 232, 6, 92,
          ]),
          pub_key: {
            ed25519: new Uint8Array([
              181, 198, 87, 163, 250, 185, 14, 112, 100, 245, 108, 116, 128, 65, 129, 234, 87, 156, 220, 9, 35, 156, 42,
              48, 92, 5, 187, 241, 18, 241, 75, 119,
            ]),
            secp256k1: undefined,
          },
          voting_power: 10n,
          proposer_priority: 0n,
        },
        total_voting_power: 0n,
      },
    };
  }
  private reset(): void {
    this.setDefault();
  }

  withChainId(chainId: string): HeaderMockBuilder {
    this.headerMock.signed_header.header.chain_id = chainId;
    return this;
  }

  withHeight(height: bigint): HeaderMockBuilder {
    this.headerMock.signed_header.header.height = height;
    return this;
  }

  withTrustedHeight(revisionHeight: bigint, revisionNumber: bigint): HeaderMockBuilder {
    this.headerMock.trusted_height.revision_height = revisionHeight;
    this.headerMock.trusted_height.revision_number = revisionNumber;
    return this;
  }

  withTime(time: { seconds: bigint; nanos: number }): HeaderMockBuilder {
    this.headerMock.signed_header.header.time = time;
    return this;
  }

  withLastBlockId(hash: Uint8Array, partSetHeaderHash: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.header.last_block_id = {
      hash,
      part_set_header: { total: 1, hash: partSetHeaderHash },
    };
    return this;
  }

  withLastCommitHash(hash: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.header.last_commit_hash = hash;
    return this;
  }

  withDataHash(hash: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.header.data_hash = hash;
    return this;
  }

  withValidatorsHash(hash: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.header.validators_hash = hash;
    return this;
  }

  withNextValidatorsHash(hash: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.header.next_validators_hash = hash;
    return this;
  }

  withConsensusHash(hash: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.header.consensus_hash = hash;
    return this;
  }

  withAppHash(hash: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.header.app_hash = hash;
    return this;
  }

  withLastResultsHash(hash: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.header.last_results_hash = hash;
    return this;
  }

  withEvidenceHash(hash: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.header.evidence_hash = hash;
    return this;
  }

  withProposerAddress(address: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.header.proposer_address = address;
    return this;
  }

  withCommitHeight(height: bigint): HeaderMockBuilder {
    this.headerMock.signed_header.commit.height = height;
    return this;
  }

  withCommitRound(round: number): HeaderMockBuilder {
    this.headerMock.signed_header.commit.round = round;
    return this;
  }

  withCommitBlockId(hash: Uint8Array, partSetHeaderHash: Uint8Array): HeaderMockBuilder {
    this.headerMock.signed_header.commit.block_id = { hash, part_set_header: { total: 1, hash: partSetHeaderHash } };
    return this;
  }

  withCommitSignature(
    signature: Uint8Array,
    validatorAddress: Uint8Array,
    timestamp: { seconds: bigint; nanos: number },
  ): HeaderMockBuilder {
    this.headerMock.signed_header.commit.signatures = [
      {
        block_id_flag: 2,
        validator_address: validatorAddress,
        timestamp,
        signature,
      },
    ];
    return this;
  }

  withValidator(
    address: Uint8Array,
    pubKey: Uint8Array,
    votingPower: bigint,
    proposerPriority: bigint,
  ): HeaderMockBuilder {
    this.headerMock.validator_set.validators = [
      {
        address,
        pub_key: { ed25519: pubKey, secp256k1: undefined },
        voting_power: votingPower,
        proposer_priority: proposerPriority,
      },
    ];
    return this;
  }

  withProposer(
    address: Uint8Array,
    pubKey: Uint8Array,
    votingPower: bigint,
    proposerPriority: bigint,
  ): HeaderMockBuilder {
    this.headerMock.validator_set.proposer = {
      address,
      pub_key: { ed25519: pubKey, secp256k1: undefined },
      voting_power: votingPower,
      proposer_priority: proposerPriority,
    };
    return this;
  }

  withTotalVotingPower(totalVotingPower: bigint): HeaderMockBuilder {
    this.headerMock.validator_set.total_voting_power = totalVotingPower;
    return this;
  }

  withTrustedValidator(
    address: Uint8Array,
    pubKey: Uint8Array,
    votingPower: bigint,
    proposerPriority: bigint,
  ): HeaderMockBuilder {
    this.headerMock.trusted_validators.validators = [
      {
        address,
        pub_key: { ed25519: pubKey, secp256k1: undefined },
        voting_power: votingPower,
        proposer_priority: proposerPriority,
      },
    ];
    return this;
  }
  withTrustedValidatorNull(): HeaderMockBuilder {
    this.headerMock.trusted_validators.validators = [
      {
        address: new Uint8Array([]),
        pub_key: { ed25519: new Uint8Array([]), secp256k1: undefined },
        voting_power: 0n,
        proposer_priority: 0n,
      },
    ];
    return this;
  }
  withTrustedValidatorNullPubKey(): HeaderMockBuilder {
    this.headerMock.trusted_validators.validators[0].pub_key = { ed25519: new Uint8Array([]), secp256k1: undefined };
    return this;
  }
  withTrustedValidatorNegativeVotingPower(): HeaderMockBuilder {
    this.headerMock.trusted_validators.validators[0].voting_power = -1n;
    return this;
  }
  withTrustedValidatorWrongSizeAddress(): HeaderMockBuilder {
    this.headerMock.trusted_validators.validators[0].address = new Uint8Array([
      197, 18, 13, 133, 141, 163, 224, 14, 197, 135, 238, 138, 76, 147, 203, 15, 86, 165, 10, 224, 9, 81, 221, 139, 20,
      132, 84, 152, 58, 226, 185, 149,
    ]);
    return this;
  }
  withValidatorSetNullValidator(): HeaderMockBuilder {
    this.headerMock.validator_set.validators = [];
    return this;
  }
  withValidatorSetValidatorPublickeyNull(): HeaderMockBuilder {
    this.headerMock.validator_set.validators[0].pub_key = {
      ed25519: new Uint8Array([]),
      secp256k1: new Uint8Array([]),
    };
    return this;
  }
  withValidatorSetNegativeVotingPower(): HeaderMockBuilder {
    this.headerMock.validator_set.validators[0].voting_power = -1n;
    return this;
  }
  withValidatorSetWrongSizeAddress(): HeaderMockBuilder {
    this.headerMock.validator_set.validators[0].address = new Uint8Array([
      197, 18, 13, 133, 141, 163, 224, 14, 197, 135, 238, 138, 76, 147, 203, 15, 86, 165, 10, 224, 9, 81, 221, 139, 20,
      132, 84, 152, 58, 226, 185, 149,
    ]);
    return this;
  }
  //
  withValidatorSetValidatorProposalPublickeyNull(): HeaderMockBuilder {
    this.headerMock.validator_set.proposer.pub_key = {
      ed25519: new Uint8Array([]),
      secp256k1: new Uint8Array([]),
    };
    return this;
  }
  withValidatorSetProposalNegativeVotingPower(): HeaderMockBuilder {
    this.headerMock.validator_set.proposer.voting_power = -1n;
    return this;
  }
  withValidatorSetProposalWrongSizeAddress(): HeaderMockBuilder {
    this.headerMock.validator_set.proposer.address = new Uint8Array([
      197, 18, 13, 133, 141, 163, 224, 14, 197, 135, 238, 138, 76, 147, 203, 15, 86, 165, 10, 224, 9, 81, 221, 139, 20,
      132, 84, 152, 58, 226, 185, 149,
    ]);
    return this;
  }

  build(): any {
    const builtHeaderMock = { ...this.headerMock };
    this.reset();
    return builtHeaderMock;
  }
  encode(): Uint8Array {
    const encoded = Header.encode(this.build()).finish();
    this.reset();
    return encoded;
  }
  encodeToBuffer(): Buffer {
    const encoded = Header.encode(this.build()).finish();
    this.reset();
    return Buffer.from(encoded);
  }
}
const headerMockBuilder = new HeaderMockBuilder();

export default headerMockBuilder;
