use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{Commit}
use ibc/client/ics_007_tendermint_client/cometbft/block/header.{TmHeader}

pub type SignedHeader {
  header: TmHeader,
  commit: Commit,
}

pub fn validate_basic(_sh: SignedHeader, _chain_id: ByteArray) -> Bool {
  True
}
