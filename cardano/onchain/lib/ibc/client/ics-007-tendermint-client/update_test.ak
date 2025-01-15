// use aiken/collection/list
// use aiken/math/rational
// use ibc/client/ics_007_tendermint_client/client_state.{ClientState}
// use ibc/client/ics_007_tendermint_client/cometbft/block/commit.{
//   BlockID, Commit, PartSetHeader,
// }
// use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}
// use ibc/client/ics_007_tendermint_client/cometbft/block/header as tm_header
// use ibc/client/ics_007_tendermint_client/cometbft/constants.{
//   block_id_flag_commit,
// }
// use ibc/client/ics_007_tendermint_client/cometbft/signed_header.{SignedHeader}
// use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
// use ibc/client/ics_007_tendermint_client/cometbft/validator_set.{ValidatorSet}
// use ibc/client/ics_007_tendermint_client/consensus_state.{ConsensusState}
// use ibc/client/ics_007_tendermint_client/header.{Header}
// use ibc/client/ics_007_tendermint_client/height.{Height}
// use ibc/client/ics_007_tendermint_client/msgs.{HeaderCase}
// use ibc/core/ics_023_vector_commitments/ics23/proofs
// use ibc/core/ics_023_vector_commitments/merkle.{MerkleRoot}

// const one_billion: Int = 1_000_000_000

// test test_verify_header_success() {
//   expect Some(one_of_third) = rational.new(1, 3)
//   let test_cases: List<(ClientState, Header, Int, ConsensusState)> =
//     [
//       // successful verify header for header with a previous height
//       (
//         client_state.new_client_state(
//           "testchain2-1",
//           one_of_third,
//           1209600 * one_billion,
//           1814400 * one_billion,
//           10 * one_billion,
//           Height { revision_number: 0, revision_height: 11 },
//           [proofs.iavl_spec(), proofs.tendermint_spec()],
//         ),
//         Header {
//           signed_header: SignedHeader {
//             header: tm_header.TmHeader {
//               chain_id: "testchain2-1",
//               height: 6,
//               time: 1577923230 * one_billion,
//               validators_hash: #"039f3acb8b22db3a7531212fb1d939c5b9f14b32772f3a93b6935d62fed567dd",
//               next_validators_hash: #"039f3acb8b22db3a7531212fb1d939c5b9f14b32772f3a93b6935d62fed567dd",
//               app_hash: #"23f99ffa39e8ea0e977888a5804ad2040404bf8f2ee2ee08f324570959e2e0d6",
//             },
//             commit: Commit {
//               height: 6,
//               round: 1,
//               block_id: BlockID {
//                 hash: #"7bed22474059fd64bd12105f2a0f675d57cb497112cd1e26444ea8b3440e360b",
//                 part_set_header: PartSetHeader {
//                   total: 3,
//                   hash: #"6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
//                 },
//               },
//               signatures: [
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"5c376975ace73ba04cc53eb3a31386c907066bf6",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"341a9470508d23163d0f75df21b5db30f60e1fff7945d2c83da83576c4fcab4eb290378bf9d42b804969a75f6b113d6083e4426c86c29b4ac7ebf31e99bf9b07",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"715456f655f32d97e09fcb06a1c0e9260d53f982",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"51a3e63ce89fd5eadd335f470b2d1c0aceee0c8f31df008c061ca6d92821731fd9fa7cd2d0a51f9087bd14826871c0ba73a0cd2f5e231f1d92c3c8e14e79180b",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"c076c96642de2df5d43a683e3686e42edca1a848",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"182177fd0d1fb32bd3a356921f56b8695e6843e6631de3cb5abe0537bcf19ce038a906aee887e7dc020697db54c5f65e050137b168273ed2bd01e0201806110d",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"c6e6f94e2675d2046e2c64bb9657217f6dfdfa2d",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"341dd6b3a23f20c1b32f30b4de77a943b715a21e9925612346778c1dd7fe51d21cc51f9ffec644bc25ad0910048fc897aa7bc2737cc56ab5c361ee356f6d8008",
//                 },
//               ],
//             },
//           },
//           validator_set: ValidatorSet {
//             validators: [
//               Validator {
//                 address: #"5c376975ace73ba04cc53eb3a31386c907066bf6",
//                 pubkey: #"c10fb23191a3b8772b97f70322130d804761069861527c04d3aca05d18deca6c",
//                 voting_power: 1,
//                 proposer_priority: -3,
//               },
//               Validator {
//                 address: #"715456f655f32d97e09fcb06a1c0e9260d53f982",
//                 pubkey: #"0ce21e18d124283e2c555691a601f08ad0a676f4d2f8e8b2a4405d4fdfb7d8cd",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"c076c96642de2df5d43a683e3686e42edca1a848",
//                 pubkey: #"552332c43defa4471e7c569a1d1902f02cc4b2f342e846c95eec88a522f5a65e",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"c6e6f94e2675d2046e2c64bb9657217f6dfdfa2d",
//                 pubkey: #"c1ba40743e457a48c56b0f109af71dd3b142a76c6391867d5007d6327b049da4",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//             ],
//             proposer: Validator {
//               address: #"5c376975ace73ba04cc53eb3a31386c907066bf6",
//               pubkey: #"c10fb23191a3b8772b97f70322130d804761069861527c04d3aca05d18deca6c",
//               voting_power: 1,
//               proposer_priority: -3,
//             },
//             total_voting_power: 4,
//           },
//           trusted_height: Height { revision_number: 0, revision_height: 4 },
//           trusted_validators: ValidatorSet {
//             validators: [
//               Validator {
//                 address: #"5c376975ace73ba04cc53eb3a31386c907066bf6",
//                 pubkey: #"c10fb23191a3b8772b97f70322130d804761069861527c04d3aca05d18deca6c",
//                 voting_power: 1,
//                 proposer_priority: -3,
//               },
//               Validator {
//                 address: #"715456f655f32d97e09fcb06a1c0e9260d53f982",
//                 pubkey: #"0ce21e18d124283e2c555691a601f08ad0a676f4d2f8e8b2a4405d4fdfb7d8cd",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"c076c96642de2df5d43a683e3686e42edca1a848",
//                 pubkey: #"552332c43defa4471e7c569a1d1902f02cc4b2f342e846c95eec88a522f5a65e",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"c6e6f94e2675d2046e2c64bb9657217f6dfdfa2d",
//                 pubkey: #"c1ba40743e457a48c56b0f109af71dd3b142a76c6391867d5007d6327b049da4",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//             ],
//             proposer: Validator {
//               address: #"5c376975ace73ba04cc53eb3a31386c907066bf6",
//               pubkey: #"c10fb23191a3b8772b97f70322130d804761069861527c04d3aca05d18deca6c",
//               voting_power: 1,
//               proposer_priority: -3,
//             },
//             total_voting_power: 4,
//           },
//         },
//         1577923260 * one_billion,
//         ConsensusState {
//           timestamp: 1577923220 * one_billion,
//           next_validators_hash: #"039f3acb8b22db3a7531212fb1d939c5b9f14b32772f3a93b6935d62fed567dd",
//           root: MerkleRoot {
//             hash: #"48f6d4a26b82affedcf0ea836df7774b21a27d9d0775cb4b03516ad982e3fa0d",
//           },
//         },
//       ),
//       // successful verify header: header with future height and different validator set
//       (
//         client_state.new_client_state(
//           "testchain2-1",
//           one_of_third,
//           1209600 * one_billion,
//           1814400 * one_billion,
//           10 * one_billion,
//           Height { revision_number: 0, revision_height: 4 },
//           [proofs.iavl_spec(), proofs.tendermint_spec()],
//         ),
//         Header {
//           signed_header: SignedHeader {
//             header: tm_header.TmHeader {
//               chain_id: "testchain2-1",
//               height: 11,
//               time: 1577923230 * one_billion,
//               validators_hash: #"b1600e6900b3d26dacbf01e455973d2c0ef4a63422a7c53c87a6de5105d25398",
//               next_validators_hash: #"e6769e2eb7bcf4383e666281fb627b20b332a76af2d72a4ee0cc1b4a44305f23",
//               app_hash: #"8c3ad1ca496c3e8025b678fa144de33ccba56302440011fd9aa2ce1b4afc767c",
//             },
//             commit: Commit {
//               height: 11,
//               round: 1,
//               block_id: BlockID {
//                 hash: #"3d7fa3dd3ec180f6a4a230bb6b3f01e2bcce84b4238dc742e36b0d9ebbe89183",
//                 part_set_header: PartSetHeader {
//                   total: 3,
//                   hash: #"6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
//                 },
//               },
//               signatures: [
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"a09400e61ffc88a4cceac5fa8ad748f43b668515",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"a40ba51dcb02a0d02c512493da2b224512a561504337e18ef67e7083ccaad0ccb145dd1c719edca5a7e238cbb7ac68f5c6b2d21f6021bcf093563208eba6a905",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"11e0ad0e8ec37edf1ad680810af5d8285bbb1b8c",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"86b4af71dddb94c465102b4aa81bb1c1cb354b9e68a19d78e783aee5b969227dd82e0ca7e9bd4898c4df494faff969ef76e9ce62973fd9de7a0fdde094322307",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"b06f18d873c677fd3f7ca3d8d0e6a7d27bba9185",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"98b965cb24e30ad1ce4613d2a48045c667585bc86bb6e3a375761a243ce84a488482ab428916540fbbee9e8ae233751e9269ffadeef8e980b1933785304bd208",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"b2c44d75b39dd234064858b7d53bf0f017c0762a",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"fbce01aa8f22aa47478b832e61a337925a71c9fef2d559df15d6e572a702dbdcd7cd99e2ced3c91c734de6f75ab0fc7246fe4c7361b54cf78c4fefbedcdeb60c",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"dbf44ec3c959b04d6269cccda1c8a0b91f484de5",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"50b0521af8df52d597c2cfcad1beba8ba0658dd61587b73eca157c649fd314f3e5a061fa7fdf06aea5ef12c6e4bdf331e5536622c06e3463f24386df9f140c0d",
//                 },
//               ],
//             },
//           },
//           validator_set: ValidatorSet {
//             validators: [
//               Validator {
//                 address: #"a09400e61ffc88a4cceac5fa8ad748f43b668515",
//                 pubkey: #"6b23c7e0ad527da7a9f64d85e9cd13819b484eb5605e90f9fe270f46d1d0f7b2",
//                 voting_power: 100,
//                 proposer_priority: -4,
//               },
//               Validator {
//                 address: #"11e0ad0e8ec37edf1ad680810af5d8285bbb1b8c",
//                 pubkey: #"e16373cc26cbf175bc0d6a3a5951dfed5812ec656087ade84c8de078241e89f0",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"b06f18d873c677fd3f7ca3d8d0e6a7d27bba9185",
//                 pubkey: #"69cd1c1a80c344de624bebf7562bb4cd55cf594ade971d54384f7b10f89ef151",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"b2c44d75b39dd234064858b7d53bf0f017c0762a",
//                 pubkey: #"b5553a8421a9593a17f74f15f1a3681359ab446118ca04ab421c125ff69af84c",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"dbf44ec3c959b04d6269cccda1c8a0b91f484de5",
//                 pubkey: #"be79a5773f43836303dc1bf99e441030e26607a124fed5b6316771546da2df1e",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//             ],
//             proposer: Validator {
//               address: #"a09400e61ffc88a4cceac5fa8ad748f43b668515",
//               pubkey: #"6b23c7e0ad527da7a9f64d85e9cd13819b484eb5605e90f9fe270f46d1d0f7b2",
//               voting_power: 100,
//               proposer_priority: -4,
//             },
//             total_voting_power: 104,
//           },
//           trusted_height: Height { revision_number: 0, revision_height: 4 },
//           trusted_validators: ValidatorSet {
//             validators: [
//               Validator {
//                 address: #"11e0ad0e8ec37edf1ad680810af5d8285bbb1b8c",
//                 pubkey: #"e16373cc26cbf175bc0d6a3a5951dfed5812ec656087ade84c8de078241e89f0",
//                 voting_power: 1,
//                 proposer_priority: -3,
//               },
//               Validator {
//                 address: #"b06f18d873c677fd3f7ca3d8d0e6a7d27bba9185",
//                 pubkey: #"69cd1c1a80c344de624bebf7562bb4cd55cf594ade971d54384f7b10f89ef151",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"b2c44d75b39dd234064858b7d53bf0f017c0762a",
//                 pubkey: #"b5553a8421a9593a17f74f15f1a3681359ab446118ca04ab421c125ff69af84c",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"dbf44ec3c959b04d6269cccda1c8a0b91f484de5",
//                 pubkey: #"be79a5773f43836303dc1bf99e441030e26607a124fed5b6316771546da2df1e",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//             ],
//             proposer: Validator {
//               address: #"11e0ad0e8ec37edf1ad680810af5d8285bbb1b8c",
//               pubkey: #"e16373cc26cbf175bc0d6a3a5951dfed5812ec656087ade84c8de078241e89f0",
//               voting_power: 1,
//               proposer_priority: -3,
//             },
//             total_voting_power: 4,
//           },
//         },
//         1577923230 * one_billion,
//         ConsensusState {
//           timestamp: 1577923220 * one_billion,
//           next_validators_hash: #"e6769e2eb7bcf4383e666281fb627b20b332a76af2d72a4ee0cc1b4a44305f23",
//           root: MerkleRoot {
//             hash: #"7b8d14355fcd8c0541190b218fba2533913e57908f85f4f77859dd422da57c1d",
//           },
//         },
//       ),
//       // successful verify header: header with next height and different validator set
//       (
//         client_state.new_client_state(
//           "testchain2-1",
//           one_of_third,
//           1209600 * one_billion,
//           1814400 * one_billion,
//           10 * one_billion,
//           Height { revision_number: 0, revision_height: 4 },
//           [proofs.iavl_spec(), proofs.tendermint_spec()],
//         ),
//         Header {
//           signed_header: SignedHeader {
//             header: tm_header.TmHeader {
//               chain_id: "testchain2-1",
//               height: 6,
//               time: 1577923230 * one_billion,
//               validators_hash: #"2de913f878346439f2a03f3a5793c68ec1b9e0b3bfcf8170a053d6477f9451e8",
//               next_validators_hash: #"b45fe6d059179ddf35216e4360f3d8c693e0d471f1c4ea842b56e9dd7e12a4db",
//               app_hash: #"a7a666d5ecc4b1a4a9e3b9a82e689cd49ed09f108df630d2c0f4faf9579e5074",
//             },
//             commit: Commit {
//               height: 6,
//               round: 1,
//               block_id: BlockID {
//                 hash: #"61c7b7df459de1d98bd20e8d93dac4f9123f1812ed19fe74fe532146d7a63d2d",
//                 part_set_header: PartSetHeader {
//                   total: 3,
//                   hash: #"6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
//                 },
//               },
//               signatures: [
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"b400af794975d3f63ef124af0c9f05e6d1c544b9",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"29d98897af0483e7a8f6e6217500ce6b3e6ec56643591cf1ef5fd9113cc372e9712e26a57748e8e6cd93cba1b78f0a61b0b88746f4149f03efefa48a75c5ed0f",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"13bada73427f61692d9e3bba1f3ced9f5e19f4f5",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"67777a551c9047c040feafbbfd5075d15aaeccf9c526d21a2cae998be0868b60c3857456dfbe3e27cc860d309aa5d11b4c149961e91973c3cb84a6626853ec04",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"247eab55e81d3a64d5e20abaedc5db2d54476c0a",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"05dcd326ff59646b1b9f157cfc932453dda9e4d785758fba11ba807fd86d90072369f594f95f222d04f7b8b4c59b371210fcef8db2fe7fa9ee3b780eece7e705",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"e0d7ee02fffbb1be8a411d10adb4e064c6e53ace",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"46815d834ad5d092ee4f813919adc0499a9797801576033a98e6a166adfbd5f3610a6e7d55a39454705add40ac1efcbade8421dca3850d4aaab6586d1248030c",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"e2b3c04bb3f7a70726b9a5856721d648e7af92ec",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"1e46a488de5bbf85f2fe8c93606794a5c630d343c4aa81ada364632cbda2e1f9b317af5bc73f948de48b3b9203461509ac95c72f8723fc51bb54303fd2461d0a",
//                 },
//               ],
//             },
//           },
//           validator_set: ValidatorSet {
//             validators: [
//               Validator {
//                 address: #"b400af794975d3f63ef124af0c9f05e6d1c544b9",
//                 pubkey: #"cb1dbf2d6418d8a412cc3c3c24881c878b500caa89d6a32c52fc7fbc964f1f99",
//                 voting_power: 100,
//                 proposer_priority: -4,
//               },
//               Validator {
//                 address: #"13bada73427f61692d9e3bba1f3ced9f5e19f4f5",
//                 pubkey: #"231aefb5aa3cc7e9b4b1b7f0815788adb6fed522f7d4b12dda19a9728ad7548d",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"247eab55e81d3a64d5e20abaedc5db2d54476c0a",
//                 pubkey: #"68bf404958ae724a19d48c41330ef8f0319a8e43fd94e335cd14729891a861df",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"e0d7ee02fffbb1be8a411d10adb4e064c6e53ace",
//                 pubkey: #"954b323b10e87937eb4e386843aae4aa2ff43b621547290934f04ae8bda5bf70",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"e2b3c04bb3f7a70726b9a5856721d648e7af92ec",
//                 pubkey: #"5f2935fd7dc28104405206fce674be23d7f69f7238ad577548292054ebd64fcb",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//             ],
//             proposer: Validator {
//               address: #"b400af794975d3f63ef124af0c9f05e6d1c544b9",
//               pubkey: #"cb1dbf2d6418d8a412cc3c3c24881c878b500caa89d6a32c52fc7fbc964f1f99",
//               voting_power: 100,
//               proposer_priority: -4,
//             },
//             total_voting_power: 104,
//           },
//           trusted_height: Height { revision_number: 0, revision_height: 4 },
//           trusted_validators: ValidatorSet {
//             validators: [
//               Validator {
//                 address: #"13bada73427f61692d9e3bba1f3ced9f5e19f4f5",
//                 pubkey: #"231aefb5aa3cc7e9b4b1b7f0815788adb6fed522f7d4b12dda19a9728ad7548d",
//                 voting_power: 1,
//                 proposer_priority: -3,
//               },
//               Validator {
//                 address: #"247eab55e81d3a64d5e20abaedc5db2d54476c0a",
//                 pubkey: #"68bf404958ae724a19d48c41330ef8f0319a8e43fd94e335cd14729891a861df",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"e0d7ee02fffbb1be8a411d10adb4e064c6e53ace",
//                 pubkey: #"954b323b10e87937eb4e386843aae4aa2ff43b621547290934f04ae8bda5bf70",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"e2b3c04bb3f7a70726b9a5856721d648e7af92ec",
//                 pubkey: #"5f2935fd7dc28104405206fce674be23d7f69f7238ad577548292054ebd64fcb",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//             ],
//             proposer: Validator {
//               address: #"13bada73427f61692d9e3bba1f3ced9f5e19f4f5",
//               pubkey: #"231aefb5aa3cc7e9b4b1b7f0815788adb6fed522f7d4b12dda19a9728ad7548d",
//               voting_power: 1,
//               proposer_priority: -3,
//             },
//             total_voting_power: 4,
//           },
//         },
//         1577923230 * one_billion,
//         ConsensusState {
//           timestamp: 1577923220 * one_billion,
//           next_validators_hash: #"b45fe6d059179ddf35216e4360f3d8c693e0d471f1c4ea842b56e9dd7e12a4db",
//           root: MerkleRoot {
//             hash: #"66b935e818a896b15c3395f4b60be437a9e631c06a149f45925823dcfde53acd",
//           },
//         },
//       ),
//       // successful update with identical header to a previous update
//       (
//         client_state.new_client_state(
//           "testchain2-1",
//           one_of_third,
//           1209600 * one_billion,
//           1814400 * one_billion,
//           10 * one_billion,
//           Height { revision_number: 0, revision_height: 6 },
//           [proofs.iavl_spec(), proofs.tendermint_spec()],
//         ),
//         Header {
//           signed_header: SignedHeader {
//             header: tm_header.TmHeader {
//               chain_id: "testchain2-1",
//               height: 6,
//               time: 1577923230 * one_billion,
//               validators_hash: #"e5fbae8527d79af4453adf3c358afd40c2bb7d9e46c8e0022e6d3049a4de71d6",
//               next_validators_hash: #"e5fbae8527d79af4453adf3c358afd40c2bb7d9e46c8e0022e6d3049a4de71d6",
//               app_hash: #"fd7da6cf858fcd6bd4b423efbc872bedb31a7c09a19476496df271b4f2a26d0c",
//             },
//             commit: Commit {
//               height: 6,
//               round: 1,
//               block_id: BlockID {
//                 hash: #"dba73b35c46a75a74938ab8d72d11d6cc6f84423049f46ac5c275a5d8b2b2a08",
//                 part_set_header: PartSetHeader {
//                   total: 3,
//                   hash: #"6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
//                 },
//               },
//               signatures: [
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"0a452cf91618bcf7f642232a97dc6ed775853b7f",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"eccaa26304588adfa27a11fa262fb5e634933c2549edc1dd5925d7f162809da66da4ed51e398027a4fcfd9508a475d35b3986c330796cb0b8cf660406d066a06",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"15fc30aabd9961be53b6141a80a477b39fb5820b",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"5f04459e340a5d04f35177c611d83ab009059a346aebb9dcf8993785e0c19633f097236cbc90dbdb1f74612c4f1ba31540d8a029073bf45714d4af425ff4f20a",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"3ae9d22a94d0e7e850a72c9ae4170eb5a06eb5e0",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"fe5c6e6de0e68b87e8d990eaab41c0a9c81d063dfe91768999d63732fb24ba4071c8fc0c71c607d5aac8cc44f3940f654c15e2ec9feeab1c0ab61cddd64b2702",
//                 },
//                 CommitSig {
//                   block_id_flag: block_id_flag_commit,
//                   validator_address: #"5be8d77f3a3fd083545d82cd42d51f65367e051b",
//                   timestamp: 1577923230 * one_billion,
//                   signature: #"fc029df68d05cc604683bbe39c701e91f8f2f05027eef144b4399d1925e45e43d80f5870e4e9568ebf32895e5251ae10dba0019372f76f8b561465d3d5064900",
//                 },
//               ],
//             },
//           },
//           validator_set: ValidatorSet {
//             validators: [
//               Validator {
//                 address: #"0a452cf91618bcf7f642232a97dc6ed775853b7f",
//                 pubkey: #"f51a77256c69417f9123ed79f1278605b2feb5fda2909c72b82edc6aaf64e921",
//                 voting_power: 1,
//                 proposer_priority: -3,
//               },
//               Validator {
//                 address: #"15fc30aabd9961be53b6141a80a477b39fb5820b",
//                 pubkey: #"fe004f3ad2691dc9c775716bde0c4093b58fb3d7bcf82913b4e52c9db86a38cd",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"3ae9d22a94d0e7e850a72c9ae4170eb5a06eb5e0",
//                 pubkey: #"33d487a92dd0d3b92cc882fd1aadc0eac88ef77f83efee2282edb070e9afb8bd",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"5be8d77f3a3fd083545d82cd42d51f65367e051b",
//                 pubkey: #"ee387ee61d3895f37960ef9ac01d059b8df0d58c39e7bc0003497c86a8b060c0",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//             ],
//             proposer: Validator {
//               address: #"0a452cf91618bcf7f642232a97dc6ed775853b7f",
//               pubkey: #"f51a77256c69417f9123ed79f1278605b2feb5fda2909c72b82edc6aaf64e921",
//               voting_power: 1,
//               proposer_priority: -3,
//             },
//             total_voting_power: 4,
//           },
//           trusted_height: Height { revision_number: 0, revision_height: 4 },
//           trusted_validators: ValidatorSet {
//             validators: [
//               Validator {
//                 address: #"0a452cf91618bcf7f642232a97dc6ed775853b7f",
//                 pubkey: #"f51a77256c69417f9123ed79f1278605b2feb5fda2909c72b82edc6aaf64e921",
//                 voting_power: 1,
//                 proposer_priority: -3,
//               },
//               Validator {
//                 address: #"15fc30aabd9961be53b6141a80a477b39fb5820b",
//                 pubkey: #"fe004f3ad2691dc9c775716bde0c4093b58fb3d7bcf82913b4e52c9db86a38cd",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"3ae9d22a94d0e7e850a72c9ae4170eb5a06eb5e0",
//                 pubkey: #"33d487a92dd0d3b92cc882fd1aadc0eac88ef77f83efee2282edb070e9afb8bd",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//               Validator {
//                 address: #"5be8d77f3a3fd083545d82cd42d51f65367e051b",
//                 pubkey: #"ee387ee61d3895f37960ef9ac01d059b8df0d58c39e7bc0003497c86a8b060c0",
//                 voting_power: 1,
//                 proposer_priority: 1,
//               },
//             ],
//             proposer: Validator {
//               address: #"0a452cf91618bcf7f642232a97dc6ed775853b7f",
//               pubkey: #"f51a77256c69417f9123ed79f1278605b2feb5fda2909c72b82edc6aaf64e921",
//               voting_power: 1,
//               proposer_priority: -3,
//             },
//             total_voting_power: 4,
//           },
//         },
//         1577923235 * one_billion,
//         ConsensusState {
//           timestamp: 1577923220 * one_billion,
//           next_validators_hash: #"e5fbae8527d79af4453adf3c358afd40c2bb7d9e46c8e0022e6d3049a4de71d6",
//           root: MerkleRoot {
//             hash: #"28daf37c835f541617d4037bdc53fdbeb5eabe7a1a48fc7429cde85a33acda51",
//           },
//         },
//       ),
//     ]
//   test_cases
//     |> list.all(
//          fn(case) {
//            update.verify_header(
//              case.1st,
//              HeaderCase {
//                h: case.2nd,
//                current_timestamp: case.3rd,
//                trusted_cons_state: case.4th,
//              },
//            ) == True
//          },
//        )
// }

// test test_verify_header_fail_with_incorrect_trust_validators_for_given_consensus_state() fail {
//   expect Some(one_of_third) = rational.new(1, 3)
//   let test_case: (ClientState, Header, Int, ConsensusState) =
//     (
//       client_state.new_client_state(
//         "testchain2-1",
//         one_of_third,
//         1209600 * one_billion,
//         1814400 * one_billion,
//         10 * one_billion,
//         Height { revision_number: 0, revision_height: 4 },
//         [proofs.iavl_spec(), proofs.tendermint_spec()],
//       ),
//       Header {
//         signed_header: SignedHeader {
//           header: tm_header.TmHeader {
//             chain_id: "testchain2-1",
//             height: 7,
//             time: 1577923230 * one_billion,
//             validators_hash: #"ccc113fbb00ddaf51b5d4272b8818662c63eba67c7d4f4a058f372e30595c8f5",
//             next_validators_hash: #"ccc113fbb00ddaf51b5d4272b8818662c63eba67c7d4f4a058f372e30595c8f5",
//             app_hash: #"2b051274dd892c6d6a0a09219d53f8078038668407678d26a75527e8269568e4",
//           },
//           commit: Commit {
//             height: 7,
//             round: 1,
//             block_id: BlockID {
//               hash: #"b041535513d91c6c512f79c723282b715b1c46aad2d06d038d42579ce721cb11",
//               part_set_header: PartSetHeader {
//                 total: 3,
//                 hash: #"6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
//               },
//             },
//             signatures: [
//               CommitSig {
//                 block_id_flag: block_id_flag_commit,
//                 validator_address: #"a664b612828fd5fc8e100616509172ac1c90d534",
//                 timestamp: 1577923230 * one_billion,
//                 signature: #"ed2f838c0db11d238d0b83f3c0f49c63bd6b7928bfc3d8a15d1d74b0b183fcbfcdb47cf908f858490b46b6a51f24d53a7abeef498e80e5f3dab4eba01887dc04",
//               },
//               CommitSig {
//                 block_id_flag: block_id_flag_commit,
//                 validator_address: #"0c5ab3131e510fc7f1782fe35f1a577f33ad0df4",
//                 timestamp: 1577923230 * one_billion,
//                 signature: #"f7798fc44357486c3c8d98edd331b386ffcbbd115cc1f49f6eef88290149604fb51cae0124f6320b7bb3cac59b621beff2916ae8150cc3ca1afd2742d700f206",
//               },
//               CommitSig {
//                 block_id_flag: block_id_flag_commit,
//                 validator_address: #"0f8cf569b8de37f6301d7ba4ba7e8113ef0f194d",
//                 timestamp: 1577923230 * one_billion,
//                 signature: #"1586b5d287f253c56b82d2cefd8d9514417f8796846f275c6b4f295a3f25d083b2a4da3adaf654b357cc7b129a4cb5f715662cd14dc82f74f9ec65c930290c00",
//               },
//               CommitSig {
//                 block_id_flag: block_id_flag_commit,
//                 validator_address: #"31c04c7458954b68a791eb1146c710076de79b39",
//                 timestamp: 1577923230 * one_billion,
//                 signature: #"c7aae1bde019c2c42e6ec78803784d41e653a65649f71dd3d771494c66376e53c51d560b02b0ef7dddb064080109b638b7324a980681c0e08fe7b2cdbd6cbb0e",
//               },
//               CommitSig {
//                 block_id_flag: block_id_flag_commit,
//                 validator_address: #"55c0c95f8738aad34e5dc0f8c982e4125595ea5f",
//                 timestamp: 1577923230 * one_billion,
//                 signature: #"fb58ce11cfc092a0336d3689d2af172229eb7d063abebe0757071f9138a05904484d50fd98cb6d61c1f92f6ffd4e24001f423b91777a7743ea2d851c7a62750b",
//               },
//             ],
//           },
//         },
//         validator_set: ValidatorSet {
//           validators: [
//             Validator {
//               address: #"a664b612828fd5fc8e100616509172ac1c90d534",
//               pubkey: #"239d1e7bc445af15af6ec739dae3fc13d374a7a6ddb51a15c864ff2daba341fb",
//               voting_power: 100,
//               proposer_priority: -4,
//             },
//             Validator {
//               address: #"0c5ab3131e510fc7f1782fe35f1a577f33ad0df4",
//               pubkey: #"55d7e11dc5c282545627d724566c95c2f3a0e5d0fc0063819b5b98ad74791a7e",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"0f8cf569b8de37f6301d7ba4ba7e8113ef0f194d",
//               pubkey: #"82d9bb8ba6d0cb8c23aeddf745874ce0aa609992a0901ec9208e25ffdf4ca855",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"31c04c7458954b68a791eb1146c710076de79b39",
//               pubkey: #"88da22713b6d37a835eb8dc7c994cf6a702f61b892a18ae634c13e2c39035a73",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"55c0c95f8738aad34e5dc0f8c982e4125595ea5f",
//               pubkey: #"e27ea9dd1770f428aaf066855f622671ab28ed77d2873253d91ba4441ac0d764",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//           ],
//           proposer: Validator {
//             address: #"a664b612828fd5fc8e100616509172ac1c90d534",
//             pubkey: #"239d1e7bc445af15af6ec739dae3fc13d374a7a6ddb51a15c864ff2daba341fb",
//             voting_power: 100,
//             proposer_priority: -4,
//           },
//           total_voting_power: 104,
//         },
//         trusted_height: Height { revision_number: 0, revision_height: 4 },
//         trusted_validators: ValidatorSet {
//           validators: [
//             Validator {
//               address: #"a664b612828fd5fc8e100616509172ac1c90d534",
//               pubkey: #"239d1e7bc445af15af6ec739dae3fc13d374a7a6ddb51a15c864ff2daba341fb",
//               voting_power: 100,
//               proposer_priority: -4,
//             },
//             Validator {
//               address: #"0c5ab3131e510fc7f1782fe35f1a577f33ad0df4",
//               pubkey: #"55d7e11dc5c282545627d724566c95c2f3a0e5d0fc0063819b5b98ad74791a7e",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"0f8cf569b8de37f6301d7ba4ba7e8113ef0f194d",
//               pubkey: #"82d9bb8ba6d0cb8c23aeddf745874ce0aa609992a0901ec9208e25ffdf4ca855",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"31c04c7458954b68a791eb1146c710076de79b39",
//               pubkey: #"88da22713b6d37a835eb8dc7c994cf6a702f61b892a18ae634c13e2c39035a73",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"55c0c95f8738aad34e5dc0f8c982e4125595ea5f",
//               pubkey: #"e27ea9dd1770f428aaf066855f622671ab28ed77d2873253d91ba4441ac0d764",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//           ],
//           proposer: Validator {
//             address: #"a664b612828fd5fc8e100616509172ac1c90d534",
//             pubkey: #"239d1e7bc445af15af6ec739dae3fc13d374a7a6ddb51a15c864ff2daba341fb",
//             voting_power: 100,
//             proposer_priority: -4,
//           },
//           total_voting_power: 104,
//         },
//       },
//       1577923230 * one_billion,
//       ConsensusState {
//         timestamp: 1577923220 * one_billion,
//         next_validators_hash: #"befed1fe0065e907515dd7a196fae5e4267cc19f7b994d8541d5fcfc41b1b969",
//         root: MerkleRoot {
//           hash: #"08c4b5b01765d083a2e4221e0a69991a4a92d06066c245d1cc98f0cda79ffec6",
//         },
//       },
//     )

//   update.verify_header(
//     test_case.1st,
//     HeaderCase {
//       h: test_case.2nd,
//       current_timestamp: test_case.3rd,
//       trusted_cons_state: test_case.4th,
//     },
//   ) == True
// }

// test test_verify_header_fail_with_future_height_when_have_too_much_change_in_validator_set() fail {
//   expect Some(one_of_third) = rational.new(1, 3)
//   let test_case: (ClientState, Header, Int, ConsensusState) =
//     (
//       client_state.new_client_state(
//         "testchain2-1",
//         one_of_third,
//         1209600 * one_billion,
//         1814400 * one_billion,
//         10 * one_billion,
//         Height { revision_number: 0, revision_height: 4 },
//         [proofs.iavl_spec(), proofs.tendermint_spec()],
//       ),
//       Header {
//         signed_header: SignedHeader {
//           header: tm_header.TmHeader {
//             chain_id: "testchain2-1",
//             height: 7,
//             time: 1577923230 * one_billion,
//             validators_hash: #"df32719ec0ad1e22aab22a355b304dc8c11281f71cba81555095b2761c4ee11a",
//             next_validators_hash: #"df32719ec0ad1e22aab22a355b304dc8c11281f71cba81555095b2761c4ee11a",
//             app_hash: #"402d575fa10de0367d053e8a024932465bda24d8853c45d50e2e49c5a0cd341e",
//           },
//           commit: Commit {
//             height: 7,
//             round: 1,
//             block_id: BlockID {
//               hash: #"506d87afc84f7b8304df9bf11464d50892511a1cbe7804c70144f4f05acd51c3",
//               part_set_header: PartSetHeader {
//                 total: 3,
//                 hash: #"6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
//               },
//             },
//             signatures: [
//               CommitSig {
//                 block_id_flag: block_id_flag_commit,
//                 validator_address: #"bc73515ba2e3606f29ece220d76087a5689c386e",
//                 timestamp: 1577923230 * one_billion,
//                 signature: #"8a0e1750b658524a5955561032f1d2e9efa9aa5478d7bd6b7876b9969a616b5c93c8b672ce7037e241319a2a1ad8b4630bc8562ace386ecc638997858207e404",
//               },
//             ],
//           },
//         },
//         validator_set: ValidatorSet {
//           validators: [
//             Validator {
//               address: #"bc73515ba2e3606f29ece220d76087a5689c386e",
//               pubkey: #"637dd4bc8ca705c673c3d9390a55e93d3bbbd76bf9e7ad254a1e328173eb4cf0",
//               voting_power: 100,
//               proposer_priority: 0,
//             },
//           ],
//           proposer: Validator {
//             address: #"bc73515ba2e3606f29ece220d76087a5689c386e",
//             pubkey: #"637dd4bc8ca705c673c3d9390a55e93d3bbbd76bf9e7ad254a1e328173eb4cf0",
//             voting_power: 100,
//             proposer_priority: 0,
//           },
//           total_voting_power: 100,
//         },
//         trusted_height: Height { revision_number: 0, revision_height: 4 },
//         trusted_validators: ValidatorSet {
//           validators: [
//             Validator {
//               address: #"773dcea30b48c36e5d75c360a2148db80c999757",
//               pubkey: #"19f5c813037de5f253ec5fcf102cf85d5610571646e61b64d2a5c829b168f31a",
//               voting_power: 1,
//               proposer_priority: -3,
//             },
//             Validator {
//               address: #"b48fd64f5498c8a2daca4f184785ad5d3d4812a1",
//               pubkey: #"558cecbdf89759687f8dc6a929cf95024d15998938849379cf92c7095c904edb",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"c14d52ca368c8b31e35ee2ffe0042d2dcce49345",
//               pubkey: #"ae846cd88dd3cce456582507f88db51f0e40cdfa68e4a315c245869b4df490b4",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"c47f5a025f565dac625f5b42b77d62a9be5e86ae",
//               pubkey: #"98b4f2038bf9dcaf99ee2c37f61f23802efe44a49de073f76ede63bfe56277f1",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//           ],
//           proposer: Validator {
//             address: #"773dcea30b48c36e5d75c360a2148db80c999757",
//             pubkey: #"19f5c813037de5f253ec5fcf102cf85d5610571646e61b64d2a5c829b168f31a",
//             voting_power: 1,
//             proposer_priority: -3,
//           },
//           total_voting_power: 4,
//         },
//       },
//       1577923230 * one_billion,
//       ConsensusState {
//         timestamp: 1577923220 * one_billion,
//         next_validators_hash: #"fa229cc3884bdc60c55fcc3dce52f0752c0a2c528cbd7684f94730652d38063a",
//         root: MerkleRoot {
//           hash: #"e677be3d74cec4d713790460a24b27e4d31f9e85f1f79ff0c545d85936d9ee03",
//         },
//       },
//     )

//   update.verify_header(
//     test_case.1st,
//     HeaderCase {
//       h: test_case.2nd,
//       current_timestamp: test_case.3rd,
//       trusted_cons_state: test_case.4th,
//     },
//   ) == True
// }

// test test_verify_header_fail_when_header_height_revision_and_trusted_height_revision_mismatch() fail {
//   expect Some(one_of_third) = rational.new(1, 3)
//   let test_case: (ClientState, Header, Int, ConsensusState) =
//     (
//       client_state.new_client_state(
//         "testchain2-1",
//         one_of_third,
//         1209600 * one_billion,
//         1814400 * one_billion,
//         10 * one_billion,
//         Height { revision_number: 0, revision_height: 11 },
//         [proofs.iavl_spec(), proofs.tendermint_spec()],
//       ),
//       Header {
//         signed_header: SignedHeader {
//           header: tm_header.TmHeader {
//             chain_id: "gaia-revision-1",
//             height: 6,
//             time: 1577923230 * one_billion,
//             validators_hash: #"039f3acb8b22db3a7531212fb1d939c5b9f14b32772f3a93b6935d62fed567dd",
//             next_validators_hash: #"039f3acb8b22db3a7531212fb1d939c5b9f14b32772f3a93b6935d62fed567dd",
//             app_hash: #"23f99ffa39e8ea0e977888a5804ad2040404bf8f2ee2ee08f324570959e2e0d6",
//           },
//           commit: Commit {
//             height: 6,
//             round: 1,
//             block_id: BlockID {
//               hash: #"7bed22474059fd64bd12105f2a0f675d57cb497112cd1e26444ea8b3440e360b",
//               part_set_header: PartSetHeader {
//                 total: 3,
//                 hash: #"6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
//               },
//             },
//             signatures: [
//               CommitSig {
//                 block_id_flag: block_id_flag_commit,
//                 validator_address: #"5c376975ace73ba04cc53eb3a31386c907066bf6",
//                 timestamp: 1577923230 * one_billion,
//                 signature: #"341a9470508d23163d0f75df21b5db30f60e1fff7945d2c83da83576c4fcab4eb290378bf9d42b804969a75f6b113d6083e4426c86c29b4ac7ebf31e99bf9b07",
//               },
//               CommitSig {
//                 block_id_flag: block_id_flag_commit,
//                 validator_address: #"715456f655f32d97e09fcb06a1c0e9260d53f982",
//                 timestamp: 1577923230 * one_billion,
//                 signature: #"51a3e63ce89fd5eadd335f470b2d1c0aceee0c8f31df008c061ca6d92821731fd9fa7cd2d0a51f9087bd14826871c0ba73a0cd2f5e231f1d92c3c8e14e79180b",
//               },
//               CommitSig {
//                 block_id_flag: block_id_flag_commit,
//                 validator_address: #"c076c96642de2df5d43a683e3686e42edca1a848",
//                 timestamp: 1577923230 * one_billion,
//                 signature: #"182177fd0d1fb32bd3a356921f56b8695e6843e6631de3cb5abe0537bcf19ce038a906aee887e7dc020697db54c5f65e050137b168273ed2bd01e0201806110d",
//               },
//               CommitSig {
//                 block_id_flag: block_id_flag_commit,
//                 validator_address: #"c6e6f94e2675d2046e2c64bb9657217f6dfdfa2d",
//                 timestamp: 1577923230 * one_billion,
//                 signature: #"341dd6b3a23f20c1b32f30b4de77a943b715a21e9925612346778c1dd7fe51d21cc51f9ffec644bc25ad0910048fc897aa7bc2737cc56ab5c361ee356f6d8008",
//               },
//             ],
//           },
//         },
//         validator_set: ValidatorSet {
//           validators: [
//             Validator {
//               address: #"5c376975ace73ba04cc53eb3a31386c907066bf6",
//               pubkey: #"c10fb23191a3b8772b97f70322130d804761069861527c04d3aca05d18deca6c",
//               voting_power: 1,
//               proposer_priority: -3,
//             },
//             Validator {
//               address: #"715456f655f32d97e09fcb06a1c0e9260d53f982",
//               pubkey: #"0ce21e18d124283e2c555691a601f08ad0a676f4d2f8e8b2a4405d4fdfb7d8cd",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"c076c96642de2df5d43a683e3686e42edca1a848",
//               pubkey: #"552332c43defa4471e7c569a1d1902f02cc4b2f342e846c95eec88a522f5a65e",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"c6e6f94e2675d2046e2c64bb9657217f6dfdfa2d",
//               pubkey: #"c1ba40743e457a48c56b0f109af71dd3b142a76c6391867d5007d6327b049da4",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//           ],
//           proposer: Validator {
//             address: #"5c376975ace73ba04cc53eb3a31386c907066bf6",
//             pubkey: #"c10fb23191a3b8772b97f70322130d804761069861527c04d3aca05d18deca6c",
//             voting_power: 1,
//             proposer_priority: -3,
//           },
//           total_voting_power: 4,
//         },
//         trusted_height: Height { revision_number: 0, revision_height: 4 },
//         trusted_validators: ValidatorSet {
//           validators: [
//             Validator {
//               address: #"5c376975ace73ba04cc53eb3a31386c907066bf6",
//               pubkey: #"c10fb23191a3b8772b97f70322130d804761069861527c04d3aca05d18deca6c",
//               voting_power: 1,
//               proposer_priority: -3,
//             },
//             Validator {
//               address: #"715456f655f32d97e09fcb06a1c0e9260d53f982",
//               pubkey: #"0ce21e18d124283e2c555691a601f08ad0a676f4d2f8e8b2a4405d4fdfb7d8cd",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"c076c96642de2df5d43a683e3686e42edca1a848",
//               pubkey: #"552332c43defa4471e7c569a1d1902f02cc4b2f342e846c95eec88a522f5a65e",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//             Validator {
//               address: #"c6e6f94e2675d2046e2c64bb9657217f6dfdfa2d",
//               pubkey: #"c1ba40743e457a48c56b0f109af71dd3b142a76c6391867d5007d6327b049da4",
//               voting_power: 1,
//               proposer_priority: 1,
//             },
//           ],
//           proposer: Validator {
//             address: #"5c376975ace73ba04cc53eb3a31386c907066bf6",
//             pubkey: #"c10fb23191a3b8772b97f70322130d804761069861527c04d3aca05d18deca6c",
//             voting_power: 1,
//             proposer_priority: -3,
//           },
//           total_voting_power: 4,
//         },
//       },
//       1577923260 * one_billion,
//       ConsensusState {
//         timestamp: 1577923220 * one_billion,
//         next_validators_hash: #"039f3acb8b22db3a7531212fb1d939c5b9f14b32772f3a93b6935d62fed567dd",
//         root: MerkleRoot {
//           hash: #"48f6d4a26b82affedcf0ea836df7774b21a27d9d0775cb4b03516ad982e3fa0d",
//         },
//       },
//     )

//   update.verify_header(
//     test_case.1st,
//     HeaderCase {
//       h: test_case.2nd,
//       current_timestamp: test_case.3rd,
//       trusted_cons_state: test_case.4th,
//     },
//   ) == True
// }
