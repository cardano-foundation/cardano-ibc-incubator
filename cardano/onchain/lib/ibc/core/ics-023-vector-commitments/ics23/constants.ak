//---------------HASHOP VARIANTS-----------------

pub const hash_op_no_hash: Int = 0

pub const hash_op_sha256: Int = 1

pub const hash_op_sha512: Int = 2

pub const hash_op_keccak256: Int = 3

pub const hash_op_ripemd160: Int = 4

pub const hash_op_bitcoin: Int = 5

pub const hash_op_sha512_256: Int = 6

pub const hash_op_blake2b_512: Int = 7

pub const hash_op_blake2s_256: Int = 8

pub const hash_op_blake3: Int = 9

//---------------LENGTHOP VARIANTS-----------------

pub const length_op_no_prefix: Int = 0

pub const length_op_var_proto: Int = 1

pub const length_op_var_rlp: Int = 2

pub const length_op_fixed32_big: Int = 3

pub const length_op_fixed32_little: Int = 4

pub const length_op_fixed64_big: Int = 5

pub const length_op_fixed64_little: Int = 6

pub const length_op_require_32_bytes: Int = 7

pub const length_op_require_64_bytes: Int = 8
