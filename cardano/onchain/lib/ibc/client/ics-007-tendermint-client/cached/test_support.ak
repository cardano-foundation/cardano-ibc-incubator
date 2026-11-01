use aiken/builtin
use aiken/collection/list
use aiken/primitive/bytearray
use ibc/client/ics_007_tendermint_client/cached/general
use ibc/client/ics_007_tendermint_client/cached/packed
use ibc/client/ics_007_tendermint_client/cached/proof
use ibc/client/ics_007_tendermint_client/cached/types.{
  Leaf, PowerChange, Record,
}
use ibc/client/ics_007_tendermint_client/cached/verify
use ibc/client/ics_007_tendermint_client/cometbft/block/commit_sig.{CommitSig}

// Test inputs only. Public keys and SHA-256 addresses increase together.
// Ed25519 seeds are SHA-256("pr982-cache-test-" ++ decimal index).
// Each signature signs 022a00, the encoded timestamp-zero vote with empty parts.
pub const a =
  #"16422c9d7631148752a34abccab69742ac15ae6135108a80ad15c90f164db81c"

pub const b =
  #"3796d417fea4a906c9d511550bfc7452dc778e7f13d71151e782a1497d1989d6"

pub const c =
  #"3a6bb364049c3162585aa197e3bec4815b2356f1db573261c6ab234058f5351e"

pub const d =
  #"3f3bd18398933fe88cf728a489d2e3b77a4ba8958f652f0b079fdebea0a6e44c"

pub const e =
  #"400bdd0dda68f7533ee803c63613f35b8eff08d3df85fd645e8448da6642491a"

pub const f =
  #"4ef961b608571f680d79c9849e0923ea88317cc43f37e1b5c36178592448a36b"

pub const g =
  #"52b3569f26c790dee4517d52dacff13d31c9724dba9e5cdb7a313c1135722d2f"

pub fn signature(key: ByteArray) -> CommitSig {
  let (address, signature) =
    when key is {
      #"16422c9d7631148752a34abccab69742ac15ae6135108a80ad15c90f164db81c" ->
        (
          #"127f2bc66677193279622f6af7346c753a4c46c7",
          #"1fccaa83c32b318e93845b7a70bd87645aaec04b9eee690fecb344934e50ca7831a4cac1a01aff124d8a28ebb33e65980f38530c4eff85bc3ecbc1cfe4b8d905",
        )
      // seed 24
      #"3796d417fea4a906c9d511550bfc7452dc778e7f13d71151e782a1497d1989d6" ->
        (
          #"12ece49af5d4d58c2dca7eacbf92dee1d8ba675e",
          #"b9896889a8d13f148a88fe4405c93b52315994e5fa94baee3adbbce4232aff571ccbc893756a2a28f30d4d4f13f9bde328c1d29efc22be89fe2f7bc5fe5f5c0a",
        )
      // seed 41
      #"3a6bb364049c3162585aa197e3bec4815b2356f1db573261c6ab234058f5351e" ->
        (
          #"2c1be0203dd2585bb63da324c762de759435ad86",
          #"72a9e866cb8df713e4464255e2d0f34e7e0c1d3780751098ef92f36c274066725e092497c043b375defe15ade49fdc3ca5b6316c0f0fdc950eb19d4999016501",
        )
      // seed 69
      #"3f3bd18398933fe88cf728a489d2e3b77a4ba8958f652f0b079fdebea0a6e44c" ->
        (
          #"38fe449428d42b2b60567e91816dcdc30aca8509",
          #"08a2f62788fba1d717130b4f0fe56753f39ebbeb5e8e30748b5c306da753423f690f2ae140ffab15283f0e8bcf67a3299a65595df55fbc27cb5c2c6cb7bb1208",
        )
      // seed 115
      #"400bdd0dda68f7533ee803c63613f35b8eff08d3df85fd645e8448da6642491a" ->
        (
          #"39d6b6889aed0f707f28931801524a0aadaafcd3",
          #"2d25e35be83979ab7eff8e264ea134a9c37181b04761f285d5cca1be023d65fd9c6d203dc9443ceb0e0de729b1b7c282c2a8a237dc731d223e62b866f230ea0f",
        )
      // seed 13
      #"4ef961b608571f680d79c9849e0923ea88317cc43f37e1b5c36178592448a36b" ->
        (
          #"57c69e3b6055b6dc24c3c4bac369eaf456a8e910",
          #"70488d58534844af492811f45cc8d996dc5d94621bd83d208836f18d5c0813bc4659df8af0d85720329e877c0e63113b192447397fbc70d0b78a331c598a7706",
        )
      // seed 65
      #"52b3569f26c790dee4517d52dacff13d31c9724dba9e5cdb7a313c1135722d2f" ->
        (
          #"5eadecfdb5bfeae2cd0d25c5e54d5300b334f53b",
          #"e209f07cb465b1c840082714ffb7faabfde00129ef00b81ea7c7ea9d34fc688ca2c357519830eacd53a334338f8fef6e935f38c7e7f84c1eceece3b2c05cfa03",
        )
      // seed 15
      _ -> fail
    }
  CommitSig {
    block_id_flag: 2,
    validator_address: address,
    timestamp: 0,
    signature,
  }
}

pub type TrustedLeaf {
  FromTarget { target_index: Int, old_power: Int }
  Prior { pubkey: ByteArray, power: Int }
}

fn power_bytes(power: Int) -> ByteArray {
  builtin.integer_to_bytearray(True, 8, power)
}

pub fn target_bytes(leaves: List<Leaf>) -> ByteArray {
  list.foldl(
    leaves,
    #"",
    fn(leaf, bytes) {
      builtin.append_bytearray(
        bytes,
        builtin.append_bytearray(leaf.pubkey, power_bytes(leaf.power)),
      )
    },
  )
}

pub fn target(leaves: List<Leaf>) -> (Record, ByteArray) {
  let order =
    list.sort(
      leaves,
      fn(left, right) { bytearray.compare(left.pubkey, right.pubkey) },
    )
      |> list.map(fn(leaf) { leaf.index })
  packed.target(target_bytes(leaves), order)
}

pub fn reference_bytes(references: List<TrustedLeaf>) -> ByteArray {
  list.foldl(
    references,
    #"",
    fn(reference, bytes) {
      let row =
        when reference is {
          FromTarget { target_index, old_power } ->
            builtin.cons_bytearray(
              0,
              builtin.cons_bytearray(target_index, power_bytes(old_power)),
            )
          Prior { pubkey, power } ->
            builtin.cons_bytearray(
              1,
              builtin.append_bytearray(pubkey, power_bytes(power)),
            )
        }
      builtin.append_bytearray(bytes, row)
    },
  )
}

pub fn full_signatures(
  vector: ByteArray,
  count: Int,
  signers: List<Leaf>,
) -> (Int, ByteArray) {
  verify.full_signatures(
    vector,
    count,
    list.map(signers, fn(leaf) { leaf.index }),
    list.map(signers, fn(leaf) { signature(leaf.pubkey) }),
    #"",
    #"",
    -1,
    0,
    builtin.integer_to_bytearray(True, 32, 0),
  )
}

pub fn trusted(
  target: List<Leaf>,
  vector: ByteArray,
  references: List<TrustedLeaf>,
  signers: List<Leaf>,
) -> (Record, Int) {
  let (_, mask) = full_signatures(vector, list.length(target), signers)
  general.trusted_packed(
    list.length(target),
    vector,
    reference_bytes(references),
    mask,
  )
}

pub fn shared_transition(
  old: Record,
  changes: List<PowerChange>,
  siblings: List<ByteArray>,
  signers: List<Leaf>,
) -> (Record, Int) {
  let next = proof.powers(old, changes, siblings)
  let (_, overlap) =
    verify.power_signatures(
      changes,
      list.map(signers, fn(leaf) { leaf.index }),
      list.map(signers, fn(leaf) { signature(leaf.pubkey) }),
      #"",
      #"",
      0,
      0,
    )
  (next, overlap)
}

pub fn hash_bytes(hashes: List<ByteArray>) -> ByteArray {
  list.foldl(
    hashes,
    #"",
    fn(hash, bytes) { builtin.append_bytearray(bytes, hash) },
  )
}

pub fn hash_vector_root(hashes: List<ByteArray>) -> ByteArray {
  proof.packed_root(list.length(hashes), hash_bytes(hashes), 32, 0)
}
