use ibc/client/ics_007_tendermint_client/cometbft/block/block_id.{BlockID}
use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/validation
use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
use ibc/client/ics_007_tendermint_client/header.{Header}
use ibc/client/ics_007_tendermint_client/height

pub type Misbehaviour {
  client_id: ByteArray,
  header1: Header,
  header2: Header,
}

/// new_misbehaviour() creates a new Misbehaviour instance.
pub fn new_misbehaviour(
  client_id: ByteArray,
  header1: Header,
  header2: Header,
) -> Misbehaviour {
  Misbehaviour { client_id, header1, header2 }
}

/// get_time() returns the timestamp at which misbehaviour occurred. It uses the
/// maximum value from both headers to prevent producing an invalid header outside
/// of the misbehaviour age range.
pub fn get_time(misbehaviour: Misbehaviour) -> Int {
  let t1 = header.get_time(misbehaviour.header1)
  let t2 = header.get_time(misbehaviour.header2)
  if t1 > t2 {
    t1
  } else {
    t2
  }
}

pub fn validate_basic(misbehaviour: Misbehaviour) -> Bool {
  expect misbehaviour.header1 != header.null_header()
  expect misbehaviour.header2 != header.null_header()
  expect misbehaviour.header1.trusted_height.revision_height != 0
  expect misbehaviour.header2.trusted_height.revision_height != 0
  expect
    misbehaviour.header1.trusted_validators != validator_set.null_validator_set()
  expect
    misbehaviour.header2.trusted_validators != validator_set.null_validator_set()
  expect
    misbehaviour.header1.signed_header.header.chain_id == misbehaviour.header2.signed_header.header.chain_id

  // TODO: Check validate_basic header for header1 and header2
  expect
    !(height.compare(
      header.get_height(misbehaviour.header1),
      header.get_height(misbehaviour.header2),
    ) == Less)
  expect
    valid_commit(
      misbehaviour.header1.signed_header.header.chain_id,
      misbehaviour.header1.signed_header.commit.block_id,
      misbehaviour.header1.signed_header.commit,
      misbehaviour.header1.validator_set,
    )
  expect
    valid_commit(
      misbehaviour.header2.signed_header.header.chain_id,
      misbehaviour.header2.signed_header.commit.block_id,
      misbehaviour.header2.signed_header.commit,
      misbehaviour.header2.validator_set,
    )
  True
}

/// valid_commit() checks if the given commit is a valid commit from the passed-in validator_set
pub fn valid_commit(
  chain_id: ByteArray,
  block_id: BlockID,
  commit: Commit,
  val_set: ValidatorSet,
) -> Bool {
  validation.verify_commit_light(
    chain_id,
    val_set,
    block_id,
    commit.height,
    commit,
    None
  )
}
