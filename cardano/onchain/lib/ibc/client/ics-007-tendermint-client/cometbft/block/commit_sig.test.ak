use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{
  CommitSig, validate_basic,
}

const validator_address = #"00112233445566778899aabbccddeeff00112233"

const max_signature =
  #"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"

const oversized_signature =
  #"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40"

fn signature(
  block_id_flag: Int,
  address: ByteArray,
  timestamp: Int,
  signature: ByteArray,
) -> CommitSig {
  CommitSig { block_id_flag, validator_address: address, timestamp, signature }
}

test flag_1_accepts_the_absent_signature_shape() {
  signature(1, #"", 0, #"") |> validate_basic
}

test flag_1_rejects_present_signature_fields() {
  and {
    !(signature(1, #[0], 0, #"") |> validate_basic),
    !(signature(1, #"", 1, #"") |> validate_basic),
    !(signature(1, #"", 0, #[0]) |> validate_basic),
  }
}

test flag_2_accepts_a_maximum_length_commit_signature() {
  signature(2, validator_address, 1_725_000_000, max_signature)
    |> validate_basic
}

test flag_2_rejects_invalid_address_or_signature_lengths() {
  and {
    !(signature(2, #"00112233445566778899aabbccddeeff001122", 0, max_signature)
      |> validate_basic),
    !(signature(2, validator_address, 0, #"") |> validate_basic),
    !(signature(2, validator_address, 0, oversized_signature)
      |> validate_basic),
  }
}

test flag_3_accepts_a_maximum_length_nil_signature() {
  signature(3, validator_address, 1_725_000_000, max_signature)
    |> validate_basic
}

test flag_3_rejects_invalid_address_or_signature_lengths() {
  and {
    !(signature(3, #"00112233445566778899aabbccddeeff001122", 0, max_signature)
      |> validate_basic),
    !(signature(3, validator_address, 0, #"") |> validate_basic),
    !(signature(3, validator_address, 0, oversized_signature)
      |> validate_basic),
  }
}
