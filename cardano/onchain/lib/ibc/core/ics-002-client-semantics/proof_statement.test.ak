use aiken/builtin
use aiken/collection/list
use ibc/client/ics_007_tendermint_client/height.{Height}
use ibc/core/ics_002_client_semantics/proof_statement.{
  MembershipStatement, NonMembershipStatement,
}
use ibc/core/ics_002_client_semantics/verify_proof_redeemer as requests
use ibc/core/ics_023_vector_commitments/merkle

fn membership(value: ByteArray) -> requests.VerifyMembershipParams {
  requests.VerifyMembershipParams {
    cs: #"11",
    cons_state: #"22",
    height: Height { revision_number: 1, revision_height: 5 },
    processed_time: 6,
    processed_height: 7,
    delay_time_period: 8,
    delay_block_period: 9,
    proof: #"ff",
    path: merkle.new_merkle_path(["ibc", value]),
    value,
  }
}

fn statement(value: ByteArray) -> MembershipStatement {
  MembershipStatement {
    cs: #"11",
    cons_state: #"22",
    height: Height { revision_number: 1, revision_height: 5 },
    processed_time: 6,
    processed_height: 7,
    delay_time_period: 8,
    delay_block_period: 9,
    path: merkle.new_merkle_path(["ibc", value]),
    value,
  }
}

fn batch(items: List<requests.VerifyMembershipParams>) -> Data {
  let raw: Data = requests.BatchVerifyMembership(items)
  raw
}

test membership_binds_every_field_except_the_cryptographic_payload() {
  let raw: Data = membership("packet-a")
  let fields = builtin.snd_pair(builtin.un_constr_data(raw))
  and {
    proof_statement.membership_matches(raw, statement("packet-a")),
    list.all(
      [0, 1, 2, 3, 4, 5, 6, 8, 9],
      fn(index) {
        let changed =
          builtin.constr_data(
            0,
            list.indexed_map(
              fields,
              fn(i, field) {
                if i == index {
                  builtin.i_data(0)
                } else {
                  field
                }
              },
            ),
          )
        !proof_statement.membership_matches(changed, statement("packet-a"))
      },
    ),
  }
}

test cryptographic_payload_is_left_entirely_to_the_pinned_verifier() {
  let raw: Data = membership("packet-a")
  let fields = builtin.snd_pair(builtin.un_constr_data(raw))
  let payloads =
    [
      builtin.i_data(0),
      builtin.b_data(#""),
      builtin.list_data([]),
      builtin.constr_data(0, []),
    ]
  list.all(
    payloads,
    fn(payload) {
      proof_statement.membership_matches(
        builtin.constr_data(
          0,
          list.indexed_map(
            fields,
            fn(i, field) {
              if i == 7 {
                payload
              } else {
                field
              }
            },
          ),
        ),
        statement("packet-a"),
      )
    },
  )
}

test membership_cannot_be_replaced_with_non_membership_or_a_batch() {
  let raw: Data = membership("packet-a")
  and {
    !proof_statement.membership_matches(
      builtin.constr_data(1, builtin.snd_pair(builtin.un_constr_data(raw))),
      statement("packet-a"),
    ),
    !proof_statement.membership_matches(
      batch([membership("packet-a")]),
      statement("packet-a"),
    ),
  }
}

test batch_binds_the_exact_request_order_and_length() {
  let first = membership("packet-a")
  let second = membership("packet-b")
  let expected = [statement("packet-a"), statement("packet-b")]
  and {
    proof_statement.membership_batch_matches(batch([first, second]), expected),
    !proof_statement.membership_batch_matches(batch([second, first]), expected),
    !proof_statement.membership_batch_matches(batch([first, first]), expected),
    !proof_statement.membership_batch_matches(batch([first]), expected),
    !proof_statement.membership_batch_matches(
      batch([first, second, first]),
      expected,
    ),
  }
}

test mixed_batch_binds_membership_and_absence_to_their_own_tables() {
  let member = membership("closed-channel")
  let absent =
    requests.VerifyNonMembershipParams {
      cs: member.cs,
      cons_state: member.cons_state,
      height: member.height,
      processed_time: member.processed_time,
      processed_height: member.processed_height,
      delay_time_period: member.delay_time_period,
      delay_block_period: member.delay_block_period,
      proof: member.proof,
      path: merkle.new_merkle_path(["ibc", "receipt"]),
    }
  let raw: Data =
    requests.BatchVerifyMembershipAndNonMembership {
      memberships: [member],
      non_memberships: [absent],
    }
  let expected_members = [statement("closed-channel")]
  let expected_absence =
    NonMembershipStatement {
      cs: absent.cs,
      cons_state: absent.cons_state,
      height: absent.height,
      processed_time: absent.processed_time,
      processed_height: absent.processed_height,
      delay_time_period: absent.delay_time_period,
      delay_block_period: absent.delay_block_period,
      path: absent.path,
    }
  let absent_data: Data = absent
  let member_data: Data = member
  let wrong_tables =
    builtin.constr_data(
      4,
      [builtin.list_data([absent_data]), builtin.list_data([member_data])],
    )
  and {
    proof_statement.non_membership_matches(
      builtin.constr_data(
        1,
        builtin.snd_pair(builtin.un_constr_data(absent_data)),
      ),
      expected_absence,
    ),
    proof_statement.mixed_batch_matches(
      raw,
      expected_members,
      [expected_absence],
    ),
    !proof_statement.mixed_batch_matches(
      wrong_tables,
      expected_members,
      [expected_absence],
    ),
  }
}

test unsupported_request_kind_cannot_authorize_a_packet() {
  !proof_statement.membership_matches(
    builtin.constr_data(3, []),
    statement("packet-a"),
  )
}

test malformed_batch_record_cannot_change_request_kind() fail {
  let raw: Data = membership("packet-a")
  let malformed =
    builtin.constr_data(1, builtin.snd_pair(builtin.un_constr_data(raw)))
  expect _ =
    proof_statement.membership_batch_matches(
      builtin.constr_data(2, [builtin.list_data([malformed])]),
      [statement("packet-a")],
    )
}
