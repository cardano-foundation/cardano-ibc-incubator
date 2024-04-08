use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader}

pub type SignedHeader {
  header: TmHeader,
  commit: Commit,
}

pub fn validate_basic(sh: SignedHeader, chain_id: ByteArray) -> Bool {
  expect
    sh.header != header.null_tm_header() && sh.commit != commit.null_commit()
  expect header.validate_basic(sh.header) && commit.validate_basic(sh.commit)
  expect sh.header.chain_id == chain_id
  expect sh.commit.height == sh.header.height
  True
}
