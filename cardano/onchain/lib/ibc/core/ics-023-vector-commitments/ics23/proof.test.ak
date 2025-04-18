use ibc/core/ics_023_vector_commitments/ics23/proof
use ibc/core/ics_023_vector_commitments/ics23/proofs.{
  CommitmentProof, CommitmentProof_Exist, ExistenceProof, InnerOp, LeafOp,
}

test test_caculate_success() {
  let valid_proof =
    CommitmentProof {
      proof: CommitmentProof_Exist {
        exist: ExistenceProof {
          key: #"3033763434454574647248423556417579715966",
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
  let expected_calculate_root =
    #"77e43ef93047a91fe457f5498bd7afc60b9dddd661d8f1225e5f40a91bda4623"
  proof.calculate(valid_proof) == expected_calculate_root
}
