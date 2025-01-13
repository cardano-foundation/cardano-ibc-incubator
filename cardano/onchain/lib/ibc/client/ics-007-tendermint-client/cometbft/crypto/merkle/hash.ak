use aiken/builtin

/// empty_hash() returns tmhash(<empty>).
/// From: https://vscode.dev/github/cometbft/cometbft/blob/main/crypto/merkle/hash.go#L16
pub fn empty_hash() -> ByteArray {
  // [227 176 196 66 152 252 28 20 154 251 244 200 153 111 185 36 39 174 65 228 100 155 147 76 164 149 153 27 120 82 184 85]
  #"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}

pub fn leaf_hash_opt_sha2_256(leaf: ByteArray) -> ByteArray {
  builtin.append_bytearray(#[0], leaf) |> builtin.sha2_256()
}

pub fn inner_hash_opt_sha2_256(left: ByteArray, right: ByteArray) -> ByteArray {
  builtin.append_bytearray(#[1], left)
    |> builtin.append_bytearray(right)
    |> builtin.sha2_256()
}
