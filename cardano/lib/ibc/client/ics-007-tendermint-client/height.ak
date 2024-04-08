use aiken/int
use ibc/utils/string
use aiken/list

pub type Height {
  // the revision that the client is currently on
  revision_number: Int,
  // the height within the given revision
  revision_height: Int,
}

pub fn new_height(revision_number: Int, revision_height: Int) -> Height {
  Height { revision_number, revision_height }
}

// TODO: 
// We need a library to manipulate strings and regex, 
// so here we temporarily return the revision number as 0
pub fn parse_chain_id(chain_id: ByteArray) -> Int {
  let parsed_str = string.split(chain_id, 45)

  if list.length(parsed_str) == 1 {
    0
  } else {
    expect [_, revision_number] = parsed_str

    expect Some(revision_number) = int.from_utf8(revision_number)

    expect revision_number >= 0

    revision_number
  }
}

pub fn is_valid(height: Height) -> Bool {
  height.revision_number >= 0 && height.revision_height >= 0
}

pub fn compare(h1: Height, h2: Height) -> Ordering {
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

pub fn zero_height() -> Height {
  Height { revision_number: 0, revision_height: 0 }
}

pub fn is_zero(height: Height) -> Bool {
  height.revision_number == 0 && height.revision_height == 0
}
