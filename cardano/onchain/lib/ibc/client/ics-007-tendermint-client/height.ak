use aiken/primitive/bytearray
use aiken/primitive/int
use ibc/utils/string

pub type Height {
  // the revision that the client is currently on
  revision_number: Int,
  // the height within the given revision
  revision_height: Int,
}

pub fn new_height(revision_number: Int, revision_height: Int) -> Height {
  Height { revision_number, revision_height }
}

const dash_char = 45

pub fn parse_chain_id(chain_id: ByteArray) -> Int {
  let dash_index = find_last_dash(chain_id, bytearray.length(chain_id), 0, -1)

  if dash_index < 0 {
    0
  } else {
    let revision_number = bytearray.drop(chain_id, dash_index + 1)
    if string.is_uint_string(revision_number) {
      expect Some(parsed_revision_number) = int.from_utf8(revision_number)
      parsed_revision_number
    } else {
      0
    }
  }
}

fn find_last_dash(
  chain_id: ByteArray,
  chain_id_length: Int,
  index: Int,
  last_dash: Int,
) -> Int {
  if index >= chain_id_length {
    last_dash
  } else if bytearray.at(chain_id, index) == dash_char {
    find_last_dash(chain_id, chain_id_length, index + 1, index)
  } else {
    find_last_dash(chain_id, chain_id_length, index + 1, last_dash)
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
