use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader} as tm_header_mod

pub type SignedHeader {
  header: TmHeader,
  commit: Commit,
}

pub fn validate_basic(sh: SignedHeader, chain_id: ByteArray) -> Bool {
  expect
    sh.header != tm_header_mod.null_tm_header() && sh.commit != commit.null_commit()

  expect
    tm_header_mod.validate_basic(sh.header) && commit.validate_basic(sh.commit)

  expect sh.header.chain_id == chain_id

  expect sh.commit.height == sh.header.height

  // TODO: uncomment this when hash function implemented
  // expect tm_header_mod.hash(sh.header) == sh.commit.block_id.hash
  True
}
