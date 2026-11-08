use aiken/builtin
use aiken/collection/list
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_023_vector_commitments/merkle.{MerklePath}

pub type MembershipStatement {
  cs: Data,
  cons_state: Data,
  height: Height,
  processed_time: Int,
  processed_height: Int,
  delay_time_period: Int,
  delay_block_period: Int,
  path: MerklePath,
  value: ByteArray,
}

pub type NonMembershipStatement {
  cs: Data,
  cons_state: Data,
  height: Height,
  processed_time: Int,
  processed_height: Int,
  delay_time_period: Int,
  delay_block_period: Int,
  path: MerklePath,
}

// VerifyProofRedeemer puts the opaque proof after its seven context fields.
// Preserve every other field, including the exact path and value.
fn without_proof(fields: List<Data>) -> List<Data> {
  expect [
    cs, consensus, height, time, block, delay_time, delay_block, _,
    ..rest
  ] = fields
  [cs, consensus, height, time, block, delay_time, delay_block, ..rest]
}

fn batch_statements(raw: Data) -> Data {
  builtin.list_data(
    list.map(
      builtin.un_list_data(raw),
      fn(item) {
        let fields = builtin.un_constr_data(item)
        expect builtin.fst_pair(fields) == 0
        builtin.constr_data(0, without_proof(builtin.snd_pair(fields)))
      },
    ),
  )
}

/// Bind the authenticated statement without decoding or comparing the ICS-23
/// payload. The pinned verifier still checks that payload cryptographically.
pub fn membership_matches(actual: Data, expected: MembershipStatement) -> Bool {
  let request = builtin.un_constr_data(actual)
  let statement: Data = expected
  and {
    builtin.fst_pair(request) == 0,
    builtin.constr_data(0, without_proof(builtin.snd_pair(request))) == statement,
  }
}

pub fn non_membership_matches(
  actual: Data,
  expected: NonMembershipStatement,
) -> Bool {
  let request = builtin.un_constr_data(actual)
  let statement: Data = expected
  and {
    builtin.fst_pair(request) == 1,
    builtin.constr_data(0, without_proof(builtin.snd_pair(request))) == statement,
  }
}

pub fn membership_batch_matches(
  actual: Data,
  expected: List<MembershipStatement>,
) -> Bool {
  let request = builtin.un_constr_data(actual)
  if builtin.fst_pair(request) == 2 {
    expect [memberships] = builtin.snd_pair(request)
    let statements: Data = expected
    batch_statements(memberships) == statements
  } else {
    False
  }
}

pub fn mixed_batch_matches(
  actual: Data,
  expected_memberships: List<MembershipStatement>,
  expected_non_memberships: List<NonMembershipStatement>,
) -> Bool {
  let request = builtin.un_constr_data(actual)
  if builtin.fst_pair(request) == 4 {
    expect [memberships, non_memberships] = builtin.snd_pair(request)
    let members: Data = expected_memberships
    let non_members: Data = expected_non_memberships
    and {
      batch_statements(memberships) == members,
      batch_statements(non_memberships) == non_members,
    }
  } else {
    False
  }
}
