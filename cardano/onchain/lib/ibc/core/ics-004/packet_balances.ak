use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray

/// Fixed-size denomination hashes keep accounting bounded independently of packet pruning.
pub const max_entries = 8

pub fn valid(balances: Pairs<ByteArray, Int>) -> Bool {
  list.length(balances) <= max_entries && list.all(
    balances,
    fn(entry) {
      let Pair(key, amount) = entry
      bytearray.length(key) == 32 && amount != 0 && absolute(amount) <= 18_446_744_073_709_551_615
    },
  ) && pairs.keys(balances) == list.sort(
    list.unique(pairs.keys(balances)),
    bytearray.compare,
  )
}

pub fn get(balances: Pairs<ByteArray, Int>, key: ByteArray) -> Int {
  when pairs.get_first(balances, key) is {
    None -> 0
    Some(amount) -> amount
  }
}

/// Redistribution may cancel opposite balances or move existing obligations.
/// It cannot invent offsetting debt or change the channel's total for any asset.
pub fn conserved(
  old_left: Pairs<ByteArray, Int>,
  old_right: Pairs<ByteArray, Int>,
  new_left: Pairs<ByteArray, Int>,
  new_right: Pairs<ByteArray, Int>,
) -> Bool {
  and {
    valid(new_left),
    valid(new_right),
    list.all(
      list.unique(
        list.concat(
          pairs.keys(old_left),
          list.concat(
            pairs.keys(old_right),
            list.concat(pairs.keys(new_left), pairs.keys(new_right)),
          ),
        ),
      ),
      fn(key) {
        let a = get(old_left, key)
        let b = get(old_right, key)
        let c = get(new_left, key)
        let d = get(new_right, key)
        a + b == c + d && absolute(c) + absolute(d) <= absolute(a) + absolute(b) && occupied(
          c,
        ) + occupied(d) <= occupied(a) + occupied(b)
      },
    ),
  }
}

fn absolute(n: Int) -> Int {
  if n < 0 {
    -n
  } else {
    n
  }
}

fn occupied(n: Int) -> Int {
  if n == 0 {
    0
  } else {
    1
  }
}
