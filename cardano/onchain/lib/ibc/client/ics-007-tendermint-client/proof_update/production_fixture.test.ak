use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/proof_update/eureka_output
use ibc/client/ics_007_tendermint_client/proof_update/misbehaviour_output
use ibc/client/ics_007_tendermint_client/proof_update/production_fixture
use ibc/client/ics_007_tendermint_client/proof_update/wrapped_proof

test tracked_injective_update_artifact_matches_exact_typed_public_values() {
  eureka_output.encode(production_fixture.update_output()) == Some(
    production_fixture.update_public_values,
  ) && bytearray.length(production_fixture.update_public_values) == 768
}

test released_injective_update_proof_verifies_with_stable_public_vk() {
  wrapped_proof.verify(
    production_fixture.update_proof_bytes,
    production_fixture.update_program_vkey,
    production_fixture.update_output(),
    production_fixture.verification_key(),
  )
}

test tracked_misbehaviour_artifact_matches_exact_typed_public_values() {
  misbehaviour_output.encode(production_fixture.misbehaviour_output()) == Some(
    production_fixture.misbehaviour_public_values,
  ) && bytearray.length(production_fixture.misbehaviour_public_values) == 768
}

test released_misbehaviour_proof_verifies_with_stable_public_vk() {
  wrapped_proof.verify_encoded(
    production_fixture.misbehaviour_proof_bytes,
    production_fixture.misbehaviour_program_vkey,
    production_fixture.misbehaviour_public_values,
    production_fixture.verification_key(),
  )
}

test stable_proofs_reject_the_other_released_program_key() {
  and {
    !wrapped_proof.verify_encoded(
      production_fixture.update_proof_bytes,
      production_fixture.misbehaviour_program_vkey,
      production_fixture.update_public_values,
      production_fixture.verification_key(),
    ),
    !wrapped_proof.verify_encoded(
      production_fixture.misbehaviour_proof_bytes,
      production_fixture.update_program_vkey,
      production_fixture.misbehaviour_public_values,
      production_fixture.verification_key(),
    ),
  }
}
