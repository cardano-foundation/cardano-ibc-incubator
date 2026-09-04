use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{
  BlockID, PartSetHeader,
}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header_mod
use ibc/client/ics_007_tendermint_client/cometbft/protos/types_pb.{Consensus}
use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/cometbft/version/consensus.{
  block_protocol,
}
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/client/ics_007_tendermint_client/misbehaviour.{Misbehaviour} as misbehaviour_mod
use ibc/utils/int.{max_uint64}

fn committed_validator_set() -> ValidatorSet {
  let proposer =
    Validator {
      address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
      pubkey: #"ceae0c5654d526f53a15df10dce9c8829640fd3001ef2e1d99ea41ce5fc46856",
      voting_power: 1,
      proposer_priority: -3,
    }

  ValidatorSet {
    validators: [
      proposer,
      Validator {
        address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
        pubkey: #"94b9a46627c7219d3deeef6eb8a17f2fd0162c9b88f8641a57def3b99620e06a",
        voting_power: 1,
        proposer_priority: 1,
      },
      Validator {
        address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
        pubkey: #"792d8a6af66d9a1d1a5d9217d216d6f4fccff8d99398713d47663f2728634997",
        voting_power: 1,
        proposer_priority: 1,
      },
      Validator {
        address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
        pubkey: #"2d2eff7b966f5841b27d419653ac13c023de2c0fd9a1cb026e8e9156c3514765",
        voting_power: 1,
        proposer_priority: 1,
      },
    ],
    proposer,
    total_voting_power: 4,
  }
}

fn committed_header() -> Header {
  let validator_set = committed_validator_set()

  Header {
    signed_header: SignedHeader {
      header: TmHeader {
        version: Consensus { block: block_protocol, app: 2 },
        chain_id: "testchain2-1",
        height: 3,
        time: 1577836805000000000,
        last_block_id: BlockID {
          hash: #"0000000000000000000000000000000000000000000000000000000000000000",
          part_set_header: PartSetHeader {
            total: 10000,
            hash: #"0000000000000000000000000000000000000000000000000000000000000000",
          },
        },
        last_commit_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
        data_hash: #"6d6e28b8b98b5327042ea50a57dd46e6cc851c72e528bdeaa6efdeeefe66a0b8",
        validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
        next_validators_hash: #"77ce91cd8346be86a659a8afe1399931af8765bac622128c73fa9df7012007b1",
        consensus_hash: #"e5e566c41ed57e3ff8cc10f184178788b8faa602b07cf1f425217bd8179f1f24",
        app_hash: #"e7c79785b51cf0f555138683cb9efce0cf624fb0d95d82153dff98d3ac06c057",
        last_results_hash: #"092e058630247ed6009863a12eee117d26cd9d08b5adcaab37f2ab35db475a37",
        evidence_hash: #"73865db08f49d58428905d389ab4ca4b96e45a3206c7a69d43a5dc7372e60714",
        proposer_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
      },
      commit: Commit {
        height: 3,
        round: 1,
        block_id: BlockID {
          hash: #"f46bdd9c80b52720c2744f1fb6feb5f48535729fab703c09ada2bafd643fe953",
          part_set_header: PartSetHeader {
            total: 3,
            hash: #"87080a39cfe336a663ea5c0d9bdeef493abdc18b7c3e3e0c8e661354c1831432",
          },
        },
        signatures: [
          CommitSig {
            block_id_flag: 2,
            validator_address: #"527acdc73a232f014ff2556aed3c7b32b056d569",
            timestamp: 1577836805000000000,
            signature: #"089320e6c61493b859d5485528bf235b1922f73e1fae9f7d9d7b0af57079f9626b5e915cda1fb3bf341707289560cedd911a6340e522c71fe7a29f3cc4c78c04",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"e00a0af166fcd30e9441311eaa050fbaaa686169",
            timestamp: 1577836805000000000,
            signature: #"8342b7063633aa39fcaf717c7075ace64a67a09dd84e4ae8c8934409c56f6b15422e4292d869c5c918c349cd47d0f14b047ae5d72f3bd453ad18b321c73f8b0c",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"e4898c3d0b56c7f0b156ab9e91532b598aba3096",
            timestamp: 1577836805000000000,
            signature: #"6b41808d685cb97f62efdb135431101c5186d43178a28322f089d6ee743fe3e4aa0ab373465dc60e8aa047517d5ecf315469af9979785483f7a4ef2ea0137c05",
          },
          CommitSig {
            block_id_flag: 2,
            validator_address: #"f437909d21f850d74fb6637efe8d9c9dd23fcf5e",
            timestamp: 1577836805000000000,
            signature: #"fc41696dca12b5965a6cf8991bf2d77b5f7aac0c9324911b3413d26eec0a8014c17f09629dd5f79d2d2deeca2124b7527219378acba17cd0ddfc8a5124226a05",
          },
        ],
      },
    },
    validator_set,
    trusted_height: Height { revision_number: 1, revision_height: 1 },
    trusted_validators: validator_set,
  }
}

fn evidence(header1: Header, header2: Header) -> Misbehaviour {
  Misbehaviour { client_id: "07-tendermint-0", header1, header2 }
}

test validate_basic_accepts_fully_committed_headers() {
  let header = committed_header()
  misbehaviour_mod.validate_basic(evidence(header, header))
}

test validate_basic_rejects_detached_header_height() fail {
  let header = committed_header()
  let detached =
    Header {
      ..header,
      signed_header: SignedHeader {
        ..header.signed_header,
        header: TmHeader { ..header.signed_header.header, height: 4 },
      },
    }

  misbehaviour_mod.validate_basic(evidence(detached, header))
}

test validate_basic_rejects_detached_header_time() fail {
  let header = committed_header()
  let detached =
    Header {
      ..header,
      signed_header: SignedHeader {
        ..header.signed_header,
        header: TmHeader {
          ..header.signed_header.header,
          time: header.signed_header.header.time - 1,
        },
      },
    }

  misbehaviour_mod.validate_basic(evidence(detached, header))
}

test validate_basic_rejects_detached_application_hash() fail {
  let header = committed_header()
  let detached =
    Header {
      ..header,
      signed_header: SignedHeader {
        ..header.signed_header,
        header: TmHeader {
          ..header.signed_header.header,
          app_hash: "fabricated app hash",
        },
      },
    }

  misbehaviour_mod.validate_basic(evidence(detached, header))
}

test validate_basic_rejects_mismatched_validator_set() fail {
  let header = committed_header()
  expect [first, ..rest] = header.validator_set.validators
  let mismatched_set =
    ValidatorSet {
      ..header.validator_set,
      validators: [
        Validator { ..first, voting_power: first.voting_power + 1 },
        ..rest
      ],
    }
  let detached = Header { ..header, validator_set: mismatched_set }

  misbehaviour_mod.validate_basic(evidence(detached, header))
}

test validate_basic_rejects_wrapped_validator_voting_power() fail {
  let header = committed_header()
  expect [first, ..rest] = header.validator_set.validators
  let wrapped_set =
    ValidatorSet {
      ..header.validator_set,
      validators: [
        Validator { ..first, voting_power: first.voting_power - max_uint64 },
        ..rest
      ],
    }
  let wrapped_header = Header { ..header, validator_set: wrapped_set }

  expect
    validator_set.hash(wrapped_set) == header.signed_header.header.validators_hash
  misbehaviour_mod.validate_basic(evidence(wrapped_header, header))
}
