use ibc/core/ics_023_vector_commitments/ics23/ics23
use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, LeafOp,
  NonExistenceProof,
}
use ibc/core/ics_023_vector_commitments/merkle.{MerklePath}
use ibc/core/ics_023_vector_commitments/merkle_prefix

test test_apply_prefix() {
  let prefix = merkle_prefix.new_merkle_prefix("storePrefixKey")
  let path_str = "pathone/pathtwo/paththree/key"
  let path = MerklePath { key_path: [path_str] }
  let prefixed_path = merkle.apply_prefix(prefix, path)
  prefixed_path == MerklePath {
    key_path: ["storePrefixKey", "pathone/pathtwo/paththree/key"],
  }
}

test test_apply_prefix_fail_with_empty_prefix() fail {
  let prefix = merkle_prefix.new_merkle_prefix("")
  let path_str = "pathone/pathtwo/paththree/key"
  let path = MerklePath { key_path: [path_str] }
  merkle.apply_prefix(prefix, path) == MerklePath {
    key_path: ["storePrefixKey", "pathone/pathtwo/paththree/key"],
  }
}

test test_get_key_success() {
  let m_path =
    MerklePath { key_path: ["storePrefixKey", "pathone/pathtwo/paththree/key"] }
  expect merkle.get_key(m_path, 0) == "storePrefixKey"
  merkle.get_key(m_path, 1) == "pathone/pathtwo/paththree/key"
}

test test_get_key_fail_with_index_too_big() fail {
  let m_path =
    MerklePath { key_path: ["storePrefixKey", "pathone/pathtwo/paththree/key"] }
  merkle.get_key(m_path, 3) == "storePrefixKey"
}

test test_verify_membership_success_exist_left_with_iavl_spec() {
  let valid_proof =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof {
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
        },
      },
    }
  let commitment_root =
    #"77e43ef93047a91fe457f5498bd7afc60b9dddd661d8f1225e5f40a91bda4623"
  let key = #"3033763434454574647248423556417579715966"
  let value = #"76616c75655f666f725f3033763434454574647248423556417579715966"
  ics23.verify_membership(
    proofs.iavl_spec(),
    commitment_root,
    valid_proof,
    key,
    value,
  )
}

test test_verify_membership_success_with_exist_right_with_iavl_spec() {
  let valid_proof =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof {
          // key: "zwsKVaKkHXGClyPshk9i"
          key: #"7a77734b56614b6b485847436c795073686b3969",
          // value:"value_for_zwsKVaKkHXGClyPshk9i"
          value: #"76616c75655f666f725f7a77734b56614b6b485847436c795073686b3969",
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
              prefix: #"02040220a80964839e7d4f4ea955249109f96d6b18909a484d5908ef1795d52f1a71b9f920",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"04080220f316e66f51c941ed0d6ec7ef9f3f230353aeac1502e833ee49644a3766062a8520",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"06100220b9657b80ff141a29840b6d66726b81168401ca5c5e47f5506aadd3ba239d97a220",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"081a0220102c2c767a05dbb21fe67a529175934f951f0a8446e72bff5bc8b00d195c6a4320",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"0a3002207368a0f84b7d52725296277d1e372557884dcf9c479894dad91e79668acfc65d20",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"0c5202208e823d5949da2f70d695f115d44a26b0a5f4fe9b15261216026442b2dd68943f20",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"0e9e0102203eb03a9dcd754a78ebd23f239699c3d7afef6ecd8ae73ae15967fdbb7242b48320",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"10f2010220d64602759351774dab3624c47b5833dd85cc5b59a92c199ffd99e0d638ccb21520",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"12d603022054299ee0368a22e4f6cb1005b188f8595e4cdec5382f34e316510d685df9fc7b20",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"14da0502209b54b6b19b6756a88140298a7b60c0449e013c7762ca26c6c7fcda1c7acf8e3b20",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"16c20a0220affb7724162f85be6e8735e8498d8467de4beaf0972162b4dc1ca1ecc89e0cc020",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"18da130220d1dcc3ed25046b94c128ff3c7d31f9c112b679411dbb8cc4acbfc872f873d00620",
              suffix: #"",
            },
          ],
        },
      },
    }
  let commitment_root =
    #"3c58f3ce248859b07e2984a4fc95f28ee9ca31729f36d5d248ce806babd27c39"
  let key = #"7a77734b56614b6b485847436c795073686b3969"
  let value = #"76616c75655f666f725f7a77734b56614b6b485847436c795073686b3969"
  ics23.verify_membership(
    proofs.iavl_spec(),
    commitment_root,
    valid_proof,
    key,
    value,
  )
}

test test_verify_membership_success_with_exist_middle_with_iavl_spec() {
  let valid_proof =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof {
          // key: "6zuzOxEAe05ygazWcKkp"
          key: #"367a757a4f7845416530357967617a57634b6b70",
          // value:"value_for_6zuzOxEAe05ygazWcKkp"
          value: #"76616c75655f666f725f367a757a4f7845416530357967617a57634b6b70",
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
              suffix: #"20e573ba32e4d48752f750145e8f49272d81e5f4d81f418c6c8e01e2bd2bb03e92",
            },
            InnerOp {
              hash: 1,
              prefix: #"060e0220",
              suffix: #"202f7453b9df6afecefcecd464d557701685ceeddcf82e2064f5d6a751fe6f448c",
            },
            InnerOp {
              hash: 1,
              prefix: #"081a0220",
              suffix: #"200a6025a49f3aff53a9fd7bd60e0f241897bdff7ff5b0386de6e582fa60a2ff64",
            },
            InnerOp {
              hash: 1,
              prefix: #"0a3402209bae0613f7ecad99b5b448714f1b66929f06ca05e92dad7a7fc9c6243475135020",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"0e80010220e508b7f979ad0f1601b3442603f928b3aba91287a4c988045a88fa1bf26df17120",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"10cc0102201abeb41c3a4ec85c07a77af6017dcb2171a1d5c278b300cc361d7b51c593b7cf20",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"12fa020220",
              suffix: #"2055337b4192edc05ba1ca4c51b110aa56feb46b5830ba19ee682c9c88a48cdfee",
            },
            InnerOp {
              hash: 1,
              prefix: #"149c060220",
              suffix: #"2092fdf4836b2561fb018c29660262b102761f25920ed43ae46bc4153a55fd161b",
            },
            InnerOp {
              hash: 1,
              prefix: #"16d80c0220",
              suffix: #"2004ddd20b8bd3c1461293922bb3f9404eecaa2d1869d651f1a304a4757bd5f646",
            },
          ],
        },
      },
    }
  let commitment_root =
    #"ce93fb31420cca24940fd7e8742ca1061b51c5d3c5438b68bf0526bc93e45274"
  let key = #"367a757a4f7845416530357967617a57634b6b70"
  let value = #"76616c75655f666f725f367a757a4f7845416530357967617a57634b6b70"
  ics23.verify_membership(
    proofs.iavl_spec(),
    commitment_root,
    valid_proof,
    key,
    value,
  )
}

test test_verify_membership_success_exist_left_with_tendermint_spec() {
  let valid_proof =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof {
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
        },
      },
    }
  let commitment_root =
    #"c569a38a5775bbda2051c34ae00894186f837c39d11dca55495b9aed14f17ddf"
  let key = #"303142424373615a55715146735259436c6a5767"
  let value = #"76616c75655f666f725f303142424373615a55715146735259436c6a5767"
  ics23.verify_membership(
    proofs.tendermint_spec(),
    commitment_root,
    valid_proof,
    key,
    value,
  )
}

test test_verify_membership_success_with_exist_right_with_tendermint_spec() {
  let valid_proof =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof {
          // key: "zxZNkSLdcMeVWRlvXEfD"
          key: #"7a785a4e6b534c64634d655657526c7658456644",
          // value:"value_for_zxZNkSLdcMeVWRlvXEfD"
          value: #"76616c75655f666f725f7a785a4e6b534c64634d655657526c7658456644",
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
              prefix: #"012634b831468dbafb1fc61a979c348ff8462da9a7d550191a6afc916ade16cc99",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"01ab814d419bfc94ee9920d0ce993ce5da011e43613daf4b6f302855760083d7dd",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"015a1568c73eaeaba567a6b2b2944b0e9a0228c931884cb5942f58ed835b8a7ac5",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"01a171412db5ee84835ef247768914e835ff80b7711e4aa8060871c2667ec3ea29",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"01f9c2491884de24fb61ba8f358a56b306a8989bd35f1f8a4c8dabce22f703cc14",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"012f12a6aa6270eff8a1628052938ff5e36cfcc5bf2eaedc0941ee46398ebc7c38",
              suffix: #"",
            },
          ],
        },
      },
    }
  let commitment_root =
    #"f54227f1a7d90aa2bf7931066196fd3072b7fe6b1fbd49d1e26e85a90d9541bb"
  let key = #"7a785a4e6b534c64634d655657526c7658456644"
  let value = #"76616c75655f666f725f7a785a4e6b534c64634d655657526c7658456644"
  ics23.verify_membership(
    proofs.tendermint_spec(),
    commitment_root,
    valid_proof,
    key,
    value,
  )
}

test test_verify_membership_success_with_exist_middle_with_terdermint_spec() {
  let valid_proof =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof {
          // key: "Q34emvo9DqEXW52RWR85"
          key: #"513334656d766f39447145585735325257523835",
          // value:"value_for_Q34emvo9DqEXW52RWR85"
          value: #"76616c75655f666f725f513334656d766f39447145585735325257523835",
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
              prefix: #"01e231d775380f2d663651e213cc726660e2ce0a2f2e9ee12cbb7df32294104a8c",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"01",
              suffix: #"14af194c63500236e52cc290ab24244fab39a520ece7e20fa93f4c9ff80c6626",
            },
            InnerOp {
              hash: 1,
              prefix: #"017966d2ead34418db2eaa04c0dffb9316805e8a0d421d1270c8954c35ee322138",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"0172339e20a49bb16795a99bd905b47f99c45e5e5a9e6b7fb223dc8fe6751e1bda",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"01",
              suffix: #"53dd1ecc25ff906a0ef4db37ee068f3d8ad6d1d49913eefb847a675a681c5ffa",
            },
            InnerOp {
              hash: 1,
              prefix: #"01",
              suffix: #"de90f9951a19497be7e389e02aa79e26faf77080e740e8743249a17a537f287d",
            },
            InnerOp {
              hash: 1,
              prefix: #"01ad4e53e981afc5a71e34ab0c4ffbccf1b468414d9d0939bd08edbd2461bc944a",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"01",
              suffix: #"9b4cf89c3995b9dd66d58ab088846b2c6b59c52c6d10ec1d759ca9e9aa5eef5c",
            },
            InnerOp {
              hash: 1,
              prefix: #"013928a078bd66ab3949f5b1846b6d354dbdc1968a416607c7d91555ca26716667",
              suffix: #"",
            },
            InnerOp {
              hash: 1,
              prefix: #"01",
              suffix: #"d2d82cf8915b9ae6f92c7eae343e37d312ace05e654ce47acdf57d0a5490b873",
            },
          ],
        },
      },
    }
  let commitment_root =
    #"494b16e3a64a85df143b2881bdd3ec94c3f8e18b343e8ff9c2d61afd05d040c8"
  let key = #"513334656d766f39447145585735325257523835"
  let value = #"76616c75655f666f725f513334656d766f39447145585735325257523835"
  ics23.verify_membership(
    proofs.tendermint_spec(),
    commitment_root,
    valid_proof,
    key,
    value,
  )
}

test test_is_left_neighbor() {
  let non_exist_proof =
    NonExistenceProof {
      key: #"72656365697074732f706f7274732f7472616e736665722f6368616e6e656c732f6368616e6e656c2d3337332f73657175656e6365732f31",
      left: ExistenceProof {
        key: #"72656365697074732f706f7274732f7472616e736665722f6368616e6e656c732f6368616e6e656c2d3337322f73657175656e6365732f31",
        value: #"01",
        leaf: LeafOp {
          hash: 1,
          prehash_key: 0,
          prehash_value: 1,
          length: 1,
          prefix: #"0002de9dd101",
        },
        path: [
          InnerOp {
            hash: 1,
            prefix: #"0406d682d20120",
            suffix: #"2083a10c79dfbe1d55519417bb521510d3cfbf55240e92253be63c7dfb81040f25",
          },
          InnerOp {
            hash: 1,
            prefix: #"060ad682d2012006b2d1e68bbb559e51e2afbc67ca7adfe09cb0d0caf40b52d76019b7bd39ca4620",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"081ad682d20120c6a111f549637aef60470213811fd8a5ddb1f7509160eb56d781592c83f558ec20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"0a2ad682d2012097f8022c88e7c351bd591f93a4c819a254dbca30a7e31e7704310ccaf60cd00520",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"0c4ad682d201203622ad33b1419dad17f3e508964683b85c663bde3a3868b0bb0f89a351b3fdf420",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"0e7ed682d20120f973bbc52eea67552412176cefa65f675cc7ecf39145302ea37b0baef3fdb8f220",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"10f001d682d20120c2c27ade1ce45b32e1795dedcfa345ccc15148e85986c9b55b8418500deba7b520",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"12bc03d682d2012085ff84006f5e62dec4c8003d315416200844882be0cc85a09a125b573bd3ac9820",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"14c005d682d20120f6cc7509ac41eb38b691487842965eaf6610f1c67a8e7baa8e6c8291e6792e1c20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"16bc08d682d201208114dc51c624d645769032fe9e2157c884c85ebf891d1deb93b2ee0a4ae87b1820",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"189a14d682d2012042d8f9b4a217527dc62276044ef2556a9ccaf16c87096f1cb59728fc8206a6e720",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"1a8a24d682d20120b2b4df54c4c3a5663c436646744d454edc35434dcec33d111d8290961e3cdb0120",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"1cba52d682d20120374064860f492d262764f093b0c2744e03ae555c6aeb66d8e3c17bbfdbc40dd020",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"1eaa9501d682d201208087b77c39d158a7b8a0240a489479c052746980d0293e4ab1d575a79cb89abc20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"20d6ed01d682d201203d2c6ace819585d8b28d6ee55e01278b2eb4d5cf54e1bc865b8987b80164f54b20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"22b2fb02d682d20120fc823031e909557456f0340d693f1954ab09e243d7c571977ebae61d8505cbde20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"24c0a605d682d20120d043ebe6e6fda3a9780fe5d01fdea86b02fee525cb77e1e0455287174b0adf2e20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"26ca8b0ed682d20120ca79ab515afa4bb2db0e45ac2b186a579b65f2b97d48a1de9036d4d5714b9c2420",
            suffix: #"",
          },
        ],
      },
      right: ExistenceProof {
        key: #"72656365697074732f706f7274732f7472616e736665722f6368616e6e656c732f6368616e6e656c2d3337332f73657175656e6365732f32",
        value: #"01",
        leaf: LeafOp {
          hash: 1,
          prehash_key: 0,
          prehash_value: 1,
          length: 1,
          prefix: #"0002b681d201",
        },
        path: [
          InnerOp {
            hash: 1,
            prefix: #"0204d682d20120",
            suffix: #"2068c7802194891f5f96ec58a7a2bc1cd4f9229a5e0bf6736dd803b3cb9cda60cf",
          },
          InnerOp {
            hash: 1,
            prefix: #"0406d682d2012095b6f31cdeb1a593ba9a59b83b47f280a7b8d9563973a4359d6897a1bf71924920",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"060ad682d2012006b2d1e68bbb559e51e2afbc67ca7adfe09cb0d0caf40b52d76019b7bd39ca4620",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"081ad682d20120c6a111f549637aef60470213811fd8a5ddb1f7509160eb56d781592c83f558ec20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"0a2ad682d2012097f8022c88e7c351bd591f93a4c819a254dbca30a7e31e7704310ccaf60cd00520",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"0c4ad682d201203622ad33b1419dad17f3e508964683b85c663bde3a3868b0bb0f89a351b3fdf420",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"0e7ed682d20120f973bbc52eea67552412176cefa65f675cc7ecf39145302ea37b0baef3fdb8f220",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"10f001d682d20120c2c27ade1ce45b32e1795dedcfa345ccc15148e85986c9b55b8418500deba7b520",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"12bc03d682d2012085ff84006f5e62dec4c8003d315416200844882be0cc85a09a125b573bd3ac9820",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"14c005d682d20120f6cc7509ac41eb38b691487842965eaf6610f1c67a8e7baa8e6c8291e6792e1c20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"16bc08d682d201208114dc51c624d645769032fe9e2157c884c85ebf891d1deb93b2ee0a4ae87b1820",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"189a14d682d2012042d8f9b4a217527dc62276044ef2556a9ccaf16c87096f1cb59728fc8206a6e720",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"1a8a24d682d20120b2b4df54c4c3a5663c436646744d454edc35434dcec33d111d8290961e3cdb0120",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"1cba52d682d20120374064860f492d262764f093b0c2744e03ae555c6aeb66d8e3c17bbfdbc40dd020",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"1eaa9501d682d201208087b77c39d158a7b8a0240a489479c052746980d0293e4ab1d575a79cb89abc20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"20d6ed01d682d201203d2c6ace819585d8b28d6ee55e01278b2eb4d5cf54e1bc865b8987b80164f54b20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"22b2fb02d682d20120fc823031e909557456f0340d693f1954ab09e243d7c571977ebae61d8505cbde20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"24c0a605d682d20120d043ebe6e6fda3a9780fe5d01fdea86b02fee525cb77e1e0455287174b0adf2e20",
            suffix: #"",
          },
          InnerOp {
            hash: 1,
            prefix: #"26ca8b0ed682d20120ca79ab515afa4bb2db0e45ac2b186a579b65f2b97d48a1de9036d4d5714b9c2420",
            suffix: #"",
          },
        ],
      },
    }
  proof.is_left_neighbor(
    proofs.iavl_spec().inner_spec,
    non_exist_proof.left.path,
    non_exist_proof.right.path,
  )
}
