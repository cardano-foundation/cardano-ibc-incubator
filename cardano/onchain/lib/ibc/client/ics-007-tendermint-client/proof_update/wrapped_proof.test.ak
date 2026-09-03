use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/proof_update/eureka_output.{
  UpdateClientOutput,
}
use ibc/client/ics_007_tendermint_client/proof_update/gnark_wrapper
use ibc/client/ics_007_tendermint_client/proof_update/test_fixture
use ibc/client/ics_007_tendermint_client/proof_update/wrapped_proof

const alternate_valid_pok =
  #"97f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"

test unpacks_exact_288_byte_wrapper_bundle() {
  wrapped_proof.unpack(test_fixture.proof_bytes) == Some(test_fixture.proof())
}

test rejects_any_non_288_byte_wrapper_bundle() {
  and {
    wrapped_proof.unpack(bytearray.take(test_fixture.proof_bytes, 287)) == None,
    wrapped_proof.unpack(bytearray.concat(test_fixture.proof_bytes, #"00")) == None,
  }
}

test reconstructs_exact_wrapper_public_inputs() {
  wrapped_proof.public_inputs(test_fixture.program_vkey, test_fixture.output()) == Some(
    [
      1,
      426_584_870_116_321_465_232_247_539_569_147_345_777_182_455_316_125_107_223_584_640_520_368_884_092,
      7_502_551_290_996_298_928_656_580_645_170_696_463_477_893_656_310_018_581_787_309_607_620_505_586_428,
    ],
  )
}

test rejects_program_vkey_not_exactly_32_bytes() {
  and {
    wrapped_proof.public_inputs(
      bytearray.take(test_fixture.program_vkey, 31),
      test_fixture.output(),
    ) == None,
    wrapped_proof.public_inputs(
      bytearray.concat(test_fixture.program_vkey, #"00"),
      test_fixture.output(),
    ) == None,
  }
}

test commitment_transcript_matches_wrapper_artifact() {
  bytearray.from_int_big_endian(
    gnark_wrapper.commitment_hash(test_fixture.proof().commitment),
    32,
  ) == #"1589d10f2d7b601456fe122e5a84cecdd1a5ff7aee0f80ee55e3e7494106dc81"
}

test checked_in_wrapped_fixture_verifies() {
  wrapped_proof.verify(
    test_fixture.proof_bytes,
    test_fixture.program_vkey,
    test_fixture.output(),
    test_fixture.verification_key(),
  )
}

test proof_rejects_changed_typed_output() {
  let output = test_fixture.output()
  !wrapped_proof.verify(
    test_fixture.proof_bytes,
    test_fixture.program_vkey,
    UpdateClientOutput { ..output, time: output.time + 1 },
    test_fixture.verification_key(),
  )
}

test proof_rejects_changed_program_vkey() {
  !wrapped_proof.verify(
    test_fixture.proof_bytes,
    #"00f170403d8173ed45e43a42ce66835f078fc5aa17be5673b1a7ad6143df097d",
    test_fixture.output(),
    test_fixture.verification_key(),
  )
}

test proof_rejects_changed_parseable_proof_data() {
  let changed_proof =
    bytearray.concat(
      bytearray.take(test_fixture.proof_bytes, 240),
      alternate_valid_pok,
    )
  !wrapped_proof.verify(
    changed_proof,
    test_fixture.program_vkey,
    test_fixture.output(),
    test_fixture.verification_key(),
  )
}
