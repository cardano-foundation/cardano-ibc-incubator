use ibc/client/ics_007_tendermint_client/cometbft/tm_validator.{Validator}
use ibc/client/ics_007_tendermint_client/multitx/types.{TrustedMembership}

/// Precomputed RFC-6962 root for a canonical 256-validator trusted set.
///
/// Leaves 0..249 use SHA-256("depth8-validator-${i}") as their public keys,
/// address SHA-256(pubkey)[0..20], and powers 1_000_000 down to 999_751.
/// Leaves 250..255 copy the public keys at target indices 6..11 in the frozen
/// Injective non-adjacent fixture and use powers 900_000 down to 899_995.
/// Distinct descending powers make the complete set canonically ordered.
pub const trusted_root: ByteArray =
  #"f9d3db106a7ffbce5de6878b57f21e68b0fc8022fadbed5b7a67952683cbd803"

pub const trusted_total_power = 255_368_860

pub const used_trusted_indices =
  113_982_837_842_983_129_870_077_688_367_927_159_293_062_641_155_239_930_226_341_059_257_789_486_989_312

/// Six real signer keys with worst-case depth-eight membership paths.
pub fn memberships() -> List<TrustedMembership> {
  [
    TrustedMembership {
      index: 250,
      trusted_validator: Validator {
        address: #"6087607e1e56f6ee7934abaf65834c92d618104c",
        pubkey: #"ce7c56a9b522b798fa97f6e180c53ea4bfaf55f4598a0872106ac6a8bdf9bb25",
        voting_power: 900_000,
        proposer_priority: 0,
      },
      audit_path: [
        #"059c51a60ee341528c28b0e13af777e22fa839de9e48d0f6faf1faf1178e0a32",
        #"a5f8f586c35a8aa1314e5e69df7a50e2937a725815176567f02502420396a8f0",
        #"750dc2d921fd1e61ccb0ff4985d71eba97d72773dbc100df253eb5badf3f3091",
        #"34ccd97619e7535c2eda2ced0772c73b919d6e1abe140712f801b0059ff46714",
        #"4e02f7b7eff5f8284c509cf45d02ceb6fe82a9490ad184ade82036125f1ad8fd",
        #"a20753b69bf99eb7350227db1ac9b06ec836f68d359b02d79ceff6e77030054f",
        #"cb0727f016347636b3cad5813f710dc620dc259ed0d25dbfe8a83cccb4135e42",
        #"2a4a2d76daf9b26fe06e28e7285c0bec3a448b6e70c3a56e29c0de9a15fb0f24",
      ],
    },
    TrustedMembership {
      index: 251,
      trusted_validator: Validator {
        address: #"6c56084e1cfa331628c8eb1da6f865922457a975",
        pubkey: #"5065fcb83bbd72baa18c53bd3fb6d8413562949b8b884dfc198a8b25991ad6ea",
        voting_power: 899_999,
        proposer_priority: 0,
      },
      audit_path: [
        #"059c51a60ee341528c28b0e13af777e22fa839de9e48d0f6faf1faf1178e0a32",
        #"a5f8f586c35a8aa1314e5e69df7a50e2937a725815176567f02502420396a8f0",
        #"750dc2d921fd1e61ccb0ff4985d71eba97d72773dbc100df253eb5badf3f3091",
        #"34ccd97619e7535c2eda2ced0772c73b919d6e1abe140712f801b0059ff46714",
        #"4e02f7b7eff5f8284c509cf45d02ceb6fe82a9490ad184ade82036125f1ad8fd",
        #"a20753b69bf99eb7350227db1ac9b06ec836f68d359b02d79ceff6e77030054f",
        #"cb0727f016347636b3cad5813f710dc620dc259ed0d25dbfe8a83cccb4135e42",
        #"2d4b758f1f9317d449099fd48a086ae0cea7a3eb07c39a050c97280dbc0f81d5",
      ],
    },
    TrustedMembership {
      index: 252,
      trusted_validator: Validator {
        address: #"bbb6b7eb2d754ec2957ca5615dd5ab79415b0b1a",
        pubkey: #"89ebf0a8bd3e6156da558e048cf126b73439130698e428693bb78f411ac1d3a8",
        voting_power: 899_998,
        proposer_priority: 0,
      },
      audit_path: [
        #"059c51a60ee341528c28b0e13af777e22fa839de9e48d0f6faf1faf1178e0a32",
        #"a5f8f586c35a8aa1314e5e69df7a50e2937a725815176567f02502420396a8f0",
        #"750dc2d921fd1e61ccb0ff4985d71eba97d72773dbc100df253eb5badf3f3091",
        #"34ccd97619e7535c2eda2ced0772c73b919d6e1abe140712f801b0059ff46714",
        #"4e02f7b7eff5f8284c509cf45d02ceb6fe82a9490ad184ade82036125f1ad8fd",
        #"1cf67b1a1abcbae1dbb2777a03a752524f84d4e05aa10b409f0ea4f01dfd0d37",
        #"49a95293e085a21fc958c1e538fe35848f83040ae650a4777a0e6c751f412363",
        #"71aab162b3156b8975842bc1f3b49a73332fc09b0f597c2dd2a2905cecad0533",
      ],
    },
    TrustedMembership {
      index: 253,
      trusted_validator: Validator {
        address: #"cf040e2ba1c2f998ec4d114038e394668994862e",
        pubkey: #"6ce903cc66900cb5b2a38c89a3b2405ba0f4de448368b329cde00fb34bc3e0e0",
        voting_power: 899_997,
        proposer_priority: 0,
      },
      audit_path: [
        #"059c51a60ee341528c28b0e13af777e22fa839de9e48d0f6faf1faf1178e0a32",
        #"a5f8f586c35a8aa1314e5e69df7a50e2937a725815176567f02502420396a8f0",
        #"750dc2d921fd1e61ccb0ff4985d71eba97d72773dbc100df253eb5badf3f3091",
        #"34ccd97619e7535c2eda2ced0772c73b919d6e1abe140712f801b0059ff46714",
        #"4e02f7b7eff5f8284c509cf45d02ceb6fe82a9490ad184ade82036125f1ad8fd",
        #"1cf67b1a1abcbae1dbb2777a03a752524f84d4e05aa10b409f0ea4f01dfd0d37",
        #"49a95293e085a21fc958c1e538fe35848f83040ae650a4777a0e6c751f412363",
        #"b9f3026d4402e4aa66576580b5e6a878519c6d7c6c0d68d732743c7bb4a23359",
      ],
    },
    TrustedMembership {
      index: 254,
      trusted_validator: Validator {
        address: #"cdf55acd97b31a67662bd0bebc673e5b5faaec04",
        pubkey: #"8162eda2e93a1fed840ae27705030e02f254ee114c9f0c84e695b2bda702adf1",
        voting_power: 899_996,
        proposer_priority: 0,
      },
      audit_path: [
        #"059c51a60ee341528c28b0e13af777e22fa839de9e48d0f6faf1faf1178e0a32",
        #"a5f8f586c35a8aa1314e5e69df7a50e2937a725815176567f02502420396a8f0",
        #"750dc2d921fd1e61ccb0ff4985d71eba97d72773dbc100df253eb5badf3f3091",
        #"34ccd97619e7535c2eda2ced0772c73b919d6e1abe140712f801b0059ff46714",
        #"4e02f7b7eff5f8284c509cf45d02ceb6fe82a9490ad184ade82036125f1ad8fd",
        #"1cf67b1a1abcbae1dbb2777a03a752524f84d4e05aa10b409f0ea4f01dfd0d37",
        #"09adbbeede61a5da718b90add00553712e5b08fb6c104f33c84228c81d9be7a5",
        #"25ef2250f046f4136e0889d0332b5a25ab8faa6bdb85b8be9e0c8b283c9736e3",
      ],
    },
    TrustedMembership {
      index: 255,
      trusted_validator: Validator {
        address: #"feaa42b0c3582cf9ebe4bd52082b90636c8bf3a5",
        pubkey: #"cf7767ce46e3ca8755d46c2170d2be1f55b493fa7a5ed578c5bdec1846202e1c",
        voting_power: 899_995,
        proposer_priority: 0,
      },
      audit_path: [
        #"059c51a60ee341528c28b0e13af777e22fa839de9e48d0f6faf1faf1178e0a32",
        #"a5f8f586c35a8aa1314e5e69df7a50e2937a725815176567f02502420396a8f0",
        #"750dc2d921fd1e61ccb0ff4985d71eba97d72773dbc100df253eb5badf3f3091",
        #"34ccd97619e7535c2eda2ced0772c73b919d6e1abe140712f801b0059ff46714",
        #"4e02f7b7eff5f8284c509cf45d02ceb6fe82a9490ad184ade82036125f1ad8fd",
        #"1cf67b1a1abcbae1dbb2777a03a752524f84d4e05aa10b409f0ea4f01dfd0d37",
        #"09adbbeede61a5da718b90add00553712e5b08fb6c104f33c84228c81d9be7a5",
        #"c770780665bddad3ee43b3858f8cbe828aad149a97df545f16867529f8fc0fb1",
      ],
    },
  ]
}
