use ibc/client/cardano_client/protos/cardano_pb.{CardanoHeight}

pub fn new_height(revision_number: Int, revision_height: Int) -> CardanoHeight {
  CardanoHeight { revision_number, revision_height }
}

// TODO: 
// We need a library to manipulate strings and regex, 
// so here we temporarily return the revision number as 0
pub fn parse_chain_id(_chain_id: ByteArray) -> Int {
  0
}

pub fn is_valid(height: CardanoHeight) -> Bool {
  height.revision_number >= 0 && height.revision_height >= 0
}

pub fn compare(h1: CardanoHeight, h2: CardanoHeight) -> Ordering {
  if h1.revision_number < h2.revision_number {
    Less
  } else if h1.revision_number > h2.revision_number {
    Greater
  } else {
    if h1.revision_height < h2.revision_height {
      Less
    } else if h1.revision_height > h2.revision_height {
      Greater
    } else {
      Equal
    }
  }
}

pub fn zero_height() -> CardanoHeight {
  CardanoHeight { revision_number: 0, revision_height: 0 }
}

pub fn is_zero(height: CardanoHeight) -> Bool {
  height.revision_number == 0 && height.revision_height == 0
}
