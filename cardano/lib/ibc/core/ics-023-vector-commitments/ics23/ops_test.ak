use aiken/list
use ibc/core/ics_023_vector_commitments/ics23/ops
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  ExistenceProof, InnerOp, LeafOp,
}

test test_check_against_iavl_spec_success() {
  let exist_proof =
    ExistenceProof {
      // key: "03v44EEtdrHB5VAuyqYf"
      key: #"3033763434454574647248423556417579715966",
      // value:"value_for_03v44EEtdrHB5VAuyqYf"
      value: #"76616c75655f666f725f3033763434454574647248423556417579715966",
      leaf: LeafOp {
        hash: 1,
        prehash_key: 0,
        prehash_value: 1,
        length: 1,
        prefix: #"000202",
      },
      path: [
        InnerOp {
          hash: 1,
          prefix: #"04060220",
          suffix: #"20afca3de8c7aefe1041f185a34e977a976b37d6ce4cce80e5e4545b93413eca02",
        },
        InnerOp {
          hash: 1,
          prefix: #"060c0220",
          suffix: #"205e1712938d9dcef396a76bbd7ea844bcc7e72a64d416485ba14e8c679402dfc3",
        },
        InnerOp {
          hash: 1,
          prefix: #"08180220",
          suffix: #"20c6a6430436f6e95ab0c90d7c3d32c7e62884a1e28e22da87f9e8c863782b7195",
        },
        InnerOp {
          hash: 1,
          prefix: #"0a2c0220",
          suffix: #"201204acd0c729844aa19ffa80cfdfcb931f1ea54167babe1872a2fdcdf520962a",
        },
        InnerOp {
          hash: 1,
          prefix: #"0c440220",
          suffix: #"20c21911260b253d74c89d95ec7534b7499b98a8b7523857f7f31e6af723245b89",
        },
        InnerOp {
          hash: 1,
          prefix: #"0e6e0220",
          suffix: #"2045a06e0b8f7391f60a5f716eeef9eb01d8c588bbdbfb4e6a67718e92ab3ed12d",
        },
        InnerOp {
          hash: 1,
          prefix: #"1296020220",
          suffix: #"209b77ab64f5b7c290b608533b70612d18a0d55ede4ccb2f9418b56aa17069e966",
        },
        InnerOp {
          hash: 1,
          prefix: #"14e6030220",
          suffix: #"20246dce928b807f040230219a808c049d7a172108db6b1c83c445c66373ea4cd9",
        },
        InnerOp {
          hash: 1,
          prefix: #"1680080220",
          suffix: #"20ec794fb7e49d3d3554680ad0df7d1cc3797201fe33fc8288581f7ad32bb995c0",
        },
        InnerOp {
          hash: 1,
          prefix: #"18b60f0220",
          suffix: #"203b05428644520c7bae4be197ecb6de54a03a18a1ebd34836eea31fe593a6b6e0",
        },
      ],
    }
  proof.check_against_spec(exist_proof, proofs.iavl_spec())
}

test test_check_against_tendermint_spec_success() {
  let exist_proof =
    ExistenceProof {
      // key: "01BBCsaZUqQFsRYCljWg"
      key: #"303142424373615a55715146735259436c6a5767",
      // value:"value_for_01BBCsaZUqQFsRYCljWg"
      value: #"76616c75655f666f725f303142424373615a55715146735259436c6a5767",
      leaf: LeafOp {
        hash: 1,
        prehash_key: 0,
        prehash_value: 1,
        length: 1,
        prefix: #"00",
      },
      path: [
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"cb3131cd98b069efcc0e8c7e68da47370adbff32266d7fcd1b0580fdf3961266",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"21d1205c1f8537205e8fb4b176f960b459d9131669968d59c456442f7673b68b",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"b82a0e7f4434b3cedb87ea83eb5a70c7dc664c77b2fe21c6245f315e58fdf745",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"bf0657a0e6fbd8f2043eb2cf751561adcf50547d16201224133eeb8d38145229",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"6d47c03df91a4a0252055d116439d34b5b73f3a24d5cb3cf0d4b08caa540cac4",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"d5d2926993fa15c7410ac4ee1f1d81afddfb0ab5f6f4706b05f407bc01638149",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"540719b26a7301ad012ac45ebe716679e5595e5570d78be9b6da8d8591afb374",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"fccaaa9950730e80b9ccf75ad2cfeab26ae750b8bd6ac1ff1c7a7502f3c64be2",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"ecb61a6d70accb79c2325fb0b51677ed1561c91af5e10578c8294002fbb3c21e",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"1b3bc1bd8d08af9f6199de84e95d646570cbd9b306a632a5acf617cbd7d1ab0a",
        },
      ],
    }
  proof.check_against_spec(exist_proof, proofs.tendermint_spec())
}

test test_check_against_spec_fail_with_other_spec() fail {
  let exist_proof =
    ExistenceProof {
      // key: "01BBCsaZUqQFsRYCljWg"
      key: #"303142424373615a55715146735259436c6a5767",
      // value:"value_for_01BBCsaZUqQFsRYCljWg"
      value: #"76616c75655f666f725f303142424373615a55715146735259436c6a5767",
      leaf: LeafOp {
        hash: 1,
        prehash_key: 0,
        prehash_value: 1,
        length: 1,
        prefix: #"00",
      },
      path: [
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"cb3131cd98b069efcc0e8c7e68da47370adbff32266d7fcd1b0580fdf3961266",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"21d1205c1f8537205e8fb4b176f960b459d9131669968d59c456442f7673b68b",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"b82a0e7f4434b3cedb87ea83eb5a70c7dc664c77b2fe21c6245f315e58fdf745",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"bf0657a0e6fbd8f2043eb2cf751561adcf50547d16201224133eeb8d38145229",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"6d47c03df91a4a0252055d116439d34b5b73f3a24d5cb3cf0d4b08caa540cac4",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"d5d2926993fa15c7410ac4ee1f1d81afddfb0ab5f6f4706b05f407bc01638149",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"540719b26a7301ad012ac45ebe716679e5595e5570d78be9b6da8d8591afb374",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"fccaaa9950730e80b9ccf75ad2cfeab26ae750b8bd6ac1ff1c7a7502f3c64be2",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"ecb61a6d70accb79c2325fb0b51677ed1561c91af5e10578c8294002fbb3c21e",
        },
        InnerOp {
          hash: 1,
          prefix: #"01",
          suffix: #"1b3bc1bd8d08af9f6199de84e95d646570cbd9b306a632a5acf617cbd7d1ab0a",
        },
      ],
    }
  proof.check_against_spec(exist_proof, proofs.iavl_spec())
}

test test_check_against_spec_leaf_op_success() {
  let leaf =
    LeafOp {
      hash: 1,
      prehash_key: 0,
      prehash_value: 1,
      length: 1,
      prefix: #"000202",
    }

  let spec = proofs.iavl_spec()
  let is_iavl_spec = proofs.spec_equals(spec, proofs.iavl_spec())

  ops.check_against_spec_leaf_op(leaf, spec, is_iavl_spec)
}

test test_check_against_spec_leaf_op_fail_with_other_spec() fail {
  let leaf =
    LeafOp {
      hash: 1,
      prehash_key: 1,
      prehash_value: 1,
      length: 1,
      prefix: #"000202",
    }

  let spec = proofs.iavl_spec()
  let is_iavl_spec = proofs.spec_equals(spec, proofs.iavl_spec())

  ops.check_against_spec_leaf_op(leaf, spec, is_iavl_spec)
}

test test_check_against_spec_inner_op_success() {
  let inner_op =
    InnerOp {
      hash: 1,
      prefix: #"04060220",
      suffix: #"20afca3de8c7aefe1041f185a34e977a976b37d6ce4cce80e5e4545b93413eca02",
    }

  let spec = proofs.iavl_spec()
  let inner_spec = spec.inner_spec
  let max_op_prefix_length =
    ( list.length(inner_spec.child_order) - 1 ) * inner_spec.child_size + inner_spec.max_prefix_length

  let is_iavl_spec = proofs.spec_equals(spec, proofs.iavl_spec())

  ops.check_against_spec_inner_op(
    inner_op,
    spec,
    1,
    spec.inner_spec,
    max_op_prefix_length,
    is_iavl_spec,
  )
}

test test_check_against_spec_inner_op_fail_with_other_spec() fail {
  let inner_op =
    InnerOp {
      hash: 1,
      prefix: #"04060220",
      suffix: #"20afca3de8c7aefe1041f185a34e977a976b37d6ce4cce80e5e4545b93413eca02",
    }
  let spec = proofs.tendermint_spec()
  let inner_spec = spec.inner_spec
  let max_op_prefix_length =
    ( list.length(inner_spec.child_order) - 1 ) * inner_spec.child_size + inner_spec.max_prefix_length

  let is_iavl_spec = proofs.spec_equals(spec, proofs.iavl_spec())

  ops.check_against_spec_inner_op(
    inner_op,
    spec,
    1,
    spec.inner_spec,
    max_op_prefix_length,
    is_iavl_spec,
  )
}

test test_apply_leaf_op_success_with_only_hash() {
  let test_leaf_op =
    LeafOp { hash: 1, prehash_key: 0, prehash_value: 0, length: 0, prefix: "" }

  let key = #"666f6f"
  let value = #"626172"
  ops.apply_leaf_op(test_leaf_op, key, value) == #"c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2"
}

test test_apply_leaf_op_success_with_length_prefix() {
  let test_leaf_op =
    LeafOp { hash: 1, prehash_key: 0, prehash_value: 0, length: 1, prefix: "" }

  let key = #"666f6f64"
  let value = #"736f6d65206c6f6e6765722074657874"
  ops.apply_leaf_op(test_leaf_op, key, value) == #"b68f5d298e915ae1753dd333da1f9cf605411a5f2e12516be6758f365e6db265"
}

test test_apply_leaf_op_success_with_prehash_and_length_prefix() {
  let test_leaf_op =
    LeafOp { hash: 1, prehash_key: 0, prehash_value: 1, length: 1, prefix: "" }

  let key = #"666f6f64"
  let value = #"79657420616e6f74686572206c6f6e6720737472696e67"
  ops.apply_leaf_op(test_leaf_op, key, value) == #"87e0483e8fb624aef2e2f7b13f4166cda485baa8e39f437c83d74c94bedb148f"
}

test test_apply_leaf_op_success_fail_with_null_key() fail {
  let test_leaf_op =
    LeafOp { hash: 1, prehash_key: 0, prehash_value: 1, length: 1, prefix: "" }

  let key = #[]
  let value = #"626172"
  ops.apply_leaf_op(test_leaf_op, key, value) == #[]
}

test test_apply_leaf_op_success_fail_with_null_value() fail {
  let test_leaf_op =
    LeafOp { hash: 1, prehash_key: 0, prehash_value: 1, length: 1, prefix: "" }

  let key = #"666f6f"
  let value = #[]
  ops.apply_leaf_op(test_leaf_op, key, value) == #[]
}

test test_apply_inner_op_success_with_prefix_and_suffix() {
  let test_inner_op =
    InnerOp { hash: 1, prefix: #"0123456789", suffix: #"deadbeef" }
  let child = #"00cafe00"
  ops.apply_inner_op(test_inner_op, child) == #"0339f76086684506a6d42a60da4b5a719febd4d96d8b8d85ae92849e3a849a5e"
}

test test_apply_inner_op_success_with_only_prefix() {
  let test_inner_op =
    InnerOp { hash: 1, prefix: #"00204080a0c0e0", suffix: #[] }
  let child = #"ffccbb997755331100"
  ops.apply_inner_op(test_inner_op, child) == #"45bece1678cf2e9f4f2ae033e546fc35a2081b2415edcb13121a0e908dca1927"
}

test test_apply_inner_op_success_with_only_suffix() {
  let test_inner_op =
    InnerOp { hash: 1, prefix: #[], suffix: #"206a757374206b696464696e6721" }
  let child =
    #"7468697320697320612073686132353620686173682c207265616c6c792e2e2e2e"
  ops.apply_inner_op(test_inner_op, child) == #"79ef671d27e42a53fba2201c1bbc529a099af578ee8a38df140795db0ae2184b"
}

test test_apply_inner_op_fail_will_null_child() fail {
  let test_inner_op =
    InnerOp { hash: 1, prefix: "0123456789", suffix: "deadbeef" }
  let child = ""
  ops.apply_inner_op(test_inner_op, child) == #[]
}
