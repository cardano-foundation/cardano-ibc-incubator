// Experimental Cosmos IAVL v1.2.2 update verifier, not wired into HostState.
// Inner IAVL hashes omit separator keys. Authenticate leaf ranks and immediate
// neighbors instead. This preserves key order without trusting a witness pivot.
use aiken/builtin
use aiken/primitive/bytearray

pub type Tree {
  Empty
  Leaf { key: ByteArray, value_hash: ByteArray, version: Int }
  Branch { version: Int, left: Tree, right: Tree }
  Pruned {
    height: Int,
    size: Int,
    version: Int,
    left_hash: ByteArray,
    right_hash: ByteArray,
  }
}

// These caches are calculated by the verifier, never supplied by the prover.
type Node {
  hash: ByteArray,
  height: Int,
  size: Int,
  body: Body,
}

type Body {
  Vacant
  Entry { key: ByteArray, value_hash: ByteArray }
  Fork { left: Node, right: Node }
  Opaque
}

pub const empty_root =
  #"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

fn empty() -> Node {
  Node { hash: empty_root, height: -1, size: 0, body: Vacant }
}

fn unsigned_varint(n: Int) -> ByteArray {
  if n < 128 {
    bytearray.push(#"", n)
  } else {
    bytearray.push(unsigned_varint(n / 128), 128 + n % 128)
  }
}

fn header(height: Int, size: Int, version: Int) -> ByteArray {
  // Go signed varint (zigzag) for metadata, unsigned varint for byte lengths.
  unsigned_varint(height * 2)
    |> bytearray.concat(unsigned_varint(size * 2))
    |> bytearray.concat(unsigned_varint(version * 2))
}

fn hash_branch(
  h: Int,
  n: Int,
  v: Int,
  left: ByteArray,
  right: ByteArray,
) -> ByteArray {
  header(h, n, v)
    |> bytearray.concat(#"20")
    |> bytearray.concat(left)
    |> bytearray.concat(#"20")
    |> bytearray.concat(right)
    |> builtin.sha2_256()
}

fn entry(key: ByteArray, value_hash: ByteArray, version: Int) -> Node {
  let hash =
    header(0, 1, version)
      |> bytearray.concat(unsigned_varint(bytearray.length(key)))
      |> bytearray.concat(key)
      |> bytearray.concat(#"20")
      |> bytearray.concat(value_hash)
      |> builtin.sha2_256()
  Node { hash, height: 0, size: 1, body: Entry { key, value_hash } }
}

fn branch(left: Node, right: Node, version: Int) -> Node {
  if left.height == -1 {
    right
  } else if right.height == -1 {
    left
  } else {
    let height =
      1 + if left.height > right.height {
        left.height
      } else {
        right.height
      }
    let size = left.size + right.size
    Node {
      hash: hash_branch(height, size, version, left.hash, right.hash),
      height,
      size,
      body: Fork { left, right },
    }
  }
}

fn valid_version(version: Int) -> Bool {
  version > 0 && version <= 9_223_372_036_854_775_807
}

fn authenticate(tree: Tree) -> Node {
  when tree is {
    Empty -> empty()
    Leaf { key, value_hash, version } -> {
      expect valid_version(version)
      expect bytearray.length(value_hash) == 32
      entry(key, value_hash, version)
    }
    Pruned { height, size, version, left_hash, right_hash } -> {
      expect height > 0 && height <= 127
      expect size > 1 && size <= 9_223_372_036_854_775_807
      expect valid_version(version)
      expect
        bytearray.length(left_hash) == 32 && bytearray.length(right_hash) == 32
      Node {
        hash: hash_branch(height, size, version, left_hash, right_hash),
        height,
        size,
        body: Opaque,
      }
    }
    Branch { version, left, right } -> {
      expect valid_version(version)
      let l = authenticate(left)
      let r = authenticate(right)
      expect l.height >= 0 && r.height >= 0
      branch(l, r, version)
    }
  }
}

pub fn root(tree: Tree) -> ByteArray {
  authenticate(tree).hash
}

fn key_at(tree: Node, index: Int) -> ByteArray {
  when tree.body is {
    Entry { key, .. } -> {
      expect index == 0
      key
    }
    Fork { left, right } ->
      if index < left.size {
        key_at(left, index)
      } else {
        key_at(right, index - left.size)
      }
    _ -> fail
  }
}

fn prove_absence(tree: Node, key: ByteArray, index: Int) -> Bool {
  if tree.height == -1 {
    index == 0
  } else {
    let neighbor = key_at(tree, index)
    if builtin.less_than_bytearray(key, neighbor) {
      // IAVL search chooses the predecessor except below the minimum key.
      // Accepting either neighbor would allow different insertion shapes.
      index == 0
    } else {
      builtin.less_than_bytearray(neighbor, key) && (
        index == tree.size - 1 || builtin.less_than_bytearray(
          key,
          key_at(tree, index + 1),
        )
      )
    }
  }
}

fn rotate_right(tree: Node, version: Int) -> Node {
  expect Fork { left, right } = tree.body
  expect Fork { left: a, right: b } = left.body
  branch(a, branch(b, right, version), version)
}

fn rotate_left(tree: Node, version: Int) -> Node {
  expect Fork { left, right } = tree.body
  expect Fork { left: b, right: c } = right.body
  branch(branch(left, b, version), c, version)
}

fn balance(left: Node, right: Node, version: Int) -> Node {
  let tree = branch(left, right, version)
  if left.height == -1 || right.height == -1 {
    tree
  } else {
    let delta = left.height - right.height
    if delta > 1 {
      expect Fork { left: a, right: b } = left.body
      if a.height >= b.height {
        rotate_right(tree, version)
      } else {
        rotate_right(
          branch(rotate_left(left, version), right, version),
          version,
        )
      }
    } else if delta < -1 {
      expect Fork { left: b, right: c } = right.body
      if c.height >= b.height {
        rotate_left(tree, version)
      } else {
        rotate_left(
          branch(left, rotate_right(right, version), version),
          version,
        )
      }
    } else {
      tree
    }
  }
}

fn change(
  tree: Node,
  index: Int,
  key: ByteArray,
  old_hash: Option<ByteArray>,
  new_hash: Option<ByteArray>,
  version: Int,
) -> Node {
  when tree.body is {
    Vacant -> {
      expect index == 0 && old_hash == None
      when new_hash is {
        None -> empty()
        Some(value_hash) -> entry(key, value_hash, version)
      }
    }
    Entry { key: found, value_hash } -> {
      expect index == 0
      if key == found {
        expect old_hash == Some(value_hash)
        when new_hash is {
          None -> empty()
          Some(value_hash) -> entry(key, value_hash, version)
        }
      } else {
        expect old_hash == None
        when new_hash is {
          None -> tree
          Some(value_hash) -> {
            let leaf = entry(key, value_hash, version)
            if builtin.less_than_bytearray(key, found) {
              branch(leaf, tree, version)
            } else {
              branch(tree, leaf, version)
            }
          }
        }
      }
    }
    Fork { left, right } ->
      if index < left.size {
        let updated = change(left, index, key, old_hash, new_hash, version)
        if old_hash == None && new_hash == None {
          tree
        } else {
          balance(updated, right, version)
        }
      } else {
        let updated =
          change(right, index - left.size, key, old_hash, new_hash, version)
        if old_hash == None && new_hash == None {
          tree
        } else {
          balance(left, updated, version)
        }
      }
    Opaque -> fail
  }
}

fn value_hash(value: ByteArray) -> Option<ByteArray> {
  // HostState represents deletion with an empty bytearray.
  if value == #"" {
    None
  } else {
    Some(builtin.sha2_256(value))
  }
}

// Version must come from the authenticated HostState transition. A production
// caller must also enforce witness limits and start from the IAVL empty root.
pub fn apply_update(
  old_root: ByteArray,
  key: ByteArray,
  old_value: ByteArray,
  new_value: ByteArray,
  version: Int,
  index: Int,
  witness: Tree,
) -> ByteArray {
  expect valid_version(version)
  let tree = authenticate(witness)
  expect index >= 0 && ( index < tree.size || tree.height == -1 && index == 0 )
  expect tree.hash == old_root
  expect old_value != #"" || prove_absence(tree, key, index)
  change(
    tree,
    index,
    key,
    value_hash(old_value),
    value_hash(new_value),
    version,
  ).hash
}
