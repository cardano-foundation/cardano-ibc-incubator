# Recorded prototype results

The results below were recorded on August 27, 2026. They are development
measurements, not production benchmarks.

Running the released Eureka guest produced:

```text
case=injective-45
validators=45
instructions=2796372
syscalls=12585
public_values_bytes=768
trusted_height=180315956
new_height=180315957

case=synthetic-200
validators=200
instructions=17222743
syscalls=107412
public_values_bytes=768
trusted_height=1
new_height=2
```

Running `go run . -prove -out artifacts-local` in the recursive-wrapper project
with the checked-in Eureka fixture produced:

```text
inner_native_verified: true
outer_constraints: 1192065
outer_public_variables_including_one_wire: 3
outer_secret_variables: 60
outer_internal_variables: 1899857
outer_commitments: 1
outer_setup_seconds: 214.810
outer_prove_seconds: 8.864
outer_verify_seconds: 0.003
outer_bls12_381_verified: true
cardano_extended_proof_bytes: 288
cardano_vk_ic_points: 4
```

The complete wrapper command took 228.15 seconds and reached a maximum resident
set size of 4,180,934,656 bytes. Setup used fresh insecure development
randomness. The checked-in artifact hashes are recorded in `provenance.json`.

Running `aiken check -m 'groth16/gnark_wrapper.{..}' --plain-numbers` produced:

```text
PASS [mem: 62385, cpu: 3380262907] wrapped_eureka_proof_verifies_on_cardano
PASS [mem: 5151, cpu: 4560705] commitment_transcript_matches_go_wrapper
PASS [mem: 53633, cpu: 2332755725] wrapped_eureka_proof_rejects_changed_public_values
PASS [mem: 70954, cpu: 3383459815] wrapped_eureka_proof_rejects_changed_commitment_pok
```
