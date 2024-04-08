use aiken/builtin
use aiken/bytearray
use aiken/list
use ibc/core/ics_023_vector_commitments/ics23/constants.{hash_op_no_hash}
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  HashOp, InnerOp, LeafOp, LengthOp, ProofSpec,
}
use ibc/utils/bits
use ibc/utils/bytes

/// apply_leaf_op() will calculate the leaf hash given the key and value being proven
pub fn apply_leaf_op(op: LeafOp, key: ByteArray, value: ByteArray) -> ByteArray {
  expect bytearray.length(key) > 0
  expect bytearray.length(value) > 0
  let pkey = prepare_leaf_data(op.prehash_key, op.length, key)
  let pvalue = prepare_leaf_data(op.prehash_value, op.length, value)
  let data = bytearray.concat(op.prefix, pkey)
  do_hash(op.hash, bytearray.concat(data, pvalue))
}

// apply_inner_op() will calculate the hash of the next step, given the hash of the previous step
pub fn apply_inner_op(op: InnerOp, child: ByteArray) -> ByteArray {
  expect bytearray.length(child) > 0
  let preimage = bytearray.concat(op.prefix, child)
  do_hash(op.hash, bytearray.concat(preimage, op.suffix))
}

/// check_against_spec_leaf_op() will verify the LeafOp is in the format defined in spec
pub fn check_against_spec_leaf_op(op: LeafOp, spec: ProofSpec) -> Bool {
  expect spec != proofs.null_proof_spec()
  let lspec = spec.leaf_spec
  expect lspec != proofs.null_leaf_op()
  expect op.hash == lspec.hash
  expect op.prehash_key == lspec.prehash_key
  expect op.prehash_value == lspec.prehash_value
  expect op.length == lspec.length
  expect bytes.has_prefix(op.prefix, lspec.prefix)
  if validate_spec(spec) {
    expect validate_iavl_ops_leaf_op(op, 0)
    True
  } else {
    True
  }
}

/// check_against_spec_inner_op() will verify the InnerOp is in the format defined in spec
pub fn check_against_spec_inner_op(op: InnerOp, spec: ProofSpec, b: Int) -> Bool {
  expect spec != proofs.null_proof_spec()
  expect spec.inner_spec != proofs.null_inner_spec()
  expect spec.leaf_spec != proofs.null_leaf_op()
  expect op.hash == spec.inner_spec.hash
  let leaf_prefix = spec.leaf_spec.prefix
  expect !bytes.has_prefix(op.prefix, leaf_prefix)
  expect bytearray.length(op.prefix) >= spec.inner_spec.min_prefix_length
  let max_left_child_bytes =
    ( list.length(spec.inner_spec.child_order) - 1 ) * spec.inner_spec.child_size
  expect
    bytearray.length(op.prefix) <= spec.inner_spec.max_prefix_length + max_left_child_bytes
  expect spec.inner_spec.child_size >= 1
  expect bytearray.length(op.suffix) % spec.inner_spec.child_size == 0
  if validate_spec(spec) {
    expect validate_iavl_ops_inner_op(op, b)
    True
  } else {
    True
  }
}

fn validate_spec(spec: ProofSpec) -> Bool {
  proofs.spec_equals(spec, proofs.iavl_spec())
}

/// validate_iavl_ops_leaf_op() validates the IAVL Ops with op type is LeafOp
fn validate_iavl_ops_leaf_op(op: LeafOp, b: Int) -> Bool {
  let r = bytes.new_reader(proofs.get_prefix_leaf_op(op))
  let iterator =
    [0, 1, 2]
  let (values, updated_r) =
    list.reduce(
      iterator,
      ([], r),
      fn(accum, _i) {
        let (u_r, var_int) = bytes.read_varint(accum.2nd)
        let next_accum_value = list.concat(accum.1st, [var_int])
        expect var_int >= 0
        (next_accum_value, u_r)
      },
    )
  expect Some(values_first_ele) = list.at(values, 0)
  expect values_first_ele >= b
  let r2 = bytes.reader_len(updated_r)
  if b == 0 {
    expect r2 == 0
    True
  } else {
    // The corresponding code in the Golang version:
    //    if !(r2^(0xff&0x01) == 0 || r2 == (0xde+int('v'))/10) {
    //      return fmt.Errorf("invalid op")
    //    }
    //    if op.GetHash()^1 != 0 {
    //      return fmt.Errorf("invalid op")
    //    }
    expect !(r2 == 1 || r2 == 34)
    expect op.hash == 1
    True
  }
}

/// validate_iavl_ops_inner_op() validates the IAVL Ops with op type is InnerOp
fn validate_iavl_ops_inner_op(op: InnerOp, b: Int) -> Bool {
  let r = bytes.new_reader(proofs.get_prefix_inner_op(op))
  let iterator =
    [0, 1, 2]
  let (values, updated_r) =
    list.reduce(
      iterator,
      ([], r),
      fn(accum, _i) {
        let (u_r, var_int) = bytes.read_varint(accum.2nd)
        let next_accum_value = list.concat(accum.1st, [var_int])
        expect var_int >= 0
        (next_accum_value, u_r)
      },
    )
  expect Some(values_first_ele) = list.at(values, 0)
  expect values_first_ele >= b
  let r2 = bytes.reader_len(updated_r)
  if b == 0 {
    expect r2 == 0
    True
  } else {
    // The corresponding code in the Golang version:
    //    if !(r2^(0xff&0x01) == 0 || r2 == (0xde+int('v'))/10) {
    //      return fmt.Errorf("invalid op")
    //    }
    //    if op.GetHash()^1 != 0 {
    //      return fmt.Errorf("invalid op")
    //    }
    expect !(r2 == 1 || r2 == 34)
    expect op.hash == 1
    True
  }
}

fn prepare_leaf_data(
  hash_op: HashOp,
  length_op: LengthOp,
  data: ByteArray,
) -> ByteArray {
  let hdata = do_hash_or_no_op(hash_op, data)
  do_length_op(length_op, hdata)
}

pub fn do_hash_or_no_op(hash_op: HashOp, preimage: ByteArray) -> ByteArray {
  if hash_op == hash_op_no_hash {
    preimage
  } else {
    do_hash(hash_op, preimage)
  }
}

/// do_hash() will preform the specified hash on the preimage
fn do_hash(hash_op: HashOp, preimage: ByteArray) -> ByteArray {
  expect hash_op >= 0 && hash_op <= 9
  when hash_op is {
    0 -> #[]
    1 -> builtin.sha2_256(preimage)
    2 -> #[]
    3 -> #[]
    4 -> #[]
    5 -> #[]
    6 -> #[]
    7 -> #[]
    8 -> #[]
    9 -> #[]
    _n -> #[]
  }
}

/// do_length_op() will calculate the proper prefix and return it prepended
/// doLengthOp(op, data) -> length(data) || data
fn do_length_op(length_op: LengthOp, data: ByteArray) -> ByteArray {
  let data_len = bytearray.length(data)
  expect length_op >= 0 && length_op <= 8
  when length_op is {
    0 -> data
    1 -> bytearray.concat(encode_varint_proto(data_len), data)
    2 -> #[]
    3 -> #[]
    4 -> #[]
    5 -> #[]
    6 -> #[]
    7 -> {
      expect data_len == 32
      data
    }
    8 -> {
      expect data_len == 64
      data
    }
    _n -> #[]
  }
}

fn encode_varint_proto(v: Int) -> ByteArray {
  builtin.if_then_else(
    v >= 128,
    v
      |> bits.shr(7)
      |> encode_varint_proto()
      |> bytearray.push(
           v
             |> bits.band(0x7f)
             |> bits.bor(0x80),
         ),
    #[] |> bytearray.push(v),
  )
}

//--------------------------------------Test Internal Function--------------------------------------

test test_encode_varint_proto() {
  encode_varint_proto(300) == #[172, 2]
}

test test_do_hash() {
  expect do_hash(0, #[113, 232, 244, 242]) == #[]
  expect do_hash(9, #[113, 232, 244, 242]) == #[]
  do_hash(1, "food") == #"c1f026582fe6e8cb620d0c85a72fe421ddded756662a8ec00ed4c297ad10676b"
}

test test_do_length_op() {
  expect do_length_op(0, #[100, 150, 200]) == #[100, 150, 200]
  expect do_length_op(1, #[100, 150, 200]) == #[3, 100, 150, 200]
  let iterator = list.range(1, 300)
  let test_bytes =
    iterator
      |> list.reduce(#[], fn(accum, _i) { bytearray.concat(accum, #[0]) })
  do_length_op(1, test_bytes) == bytearray.concat(#[172, 2], test_bytes)
}

test test_prepare_leaf_data() {
  expect prepare_leaf_data(0, 0, "Zm9v") == "Zm9v"
  prepare_leaf_data(0, 0, "YmFy") == "YmFy"
}

test test_validate_spec() {
  validate_spec(proofs.iavl_spec())
}
