use aiken/list
use ibc/client/ics_007_tendermint_client/cometbft/crypto/merkle/tree

test test_hash_from_byte_slices_sha2_256() {
  let test_cases: List<(List<ByteArray>, ByteArray)> =
    [
      ([], #"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
      (
        [#[1, 2, 3]],
        #"054edec1d0211f624fed0cbca9d4f9400b0e491c43742af2c5b0abebf0c990d8",
      ),
      (
        [#[]],
        #"6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
      ),
      (
        [#[1, 2, 3], #[4, 5, 6]],
        #"82e6cfce00453804379b53962939eaa7906b39904be0813fcadd31b100773c4b",
      ),
      (
        [#[1, 2], #[3, 4], #[5, 6], #[7, 8], #[9, 10]],
        #"f326493eceab4f2d9ffbc78c59432a0a005d6ea98392045c74df5d14a113be18",
      ),
    ]
  test_cases
    |> list.all(
         fn(case) { tree.hash_from_byte_slices_sha2_256(case.1st) == case.2nd },
       )
}
