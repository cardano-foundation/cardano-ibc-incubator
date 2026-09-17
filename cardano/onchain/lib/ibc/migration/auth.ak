use aiken/builtin
use aiken/collection/dict
use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use cardano/address.{Address, Script}
use cardano/assets
use cardano/transaction.{Input, Output, OutputReference, Spend, Transaction}
use ibc/auth.{AuthToken}
use ibc/migration/types.{
  ActiveRegistry, Authority, Governance, Implementation, OperationalIdentity,
  OperationalImplementation, migration_spend_tag, minimum_delay_ms,
  registry_token_name, role_count,
}
use ibc/utils/validator_utils

pub fn role_address(implementation: Implementation, role: Int) -> Address {
  expect role >= 0 && role < role_count
  expect Some(address) = list.at(implementation.addresses, role)
  address
}

pub fn role_hash(implementation: Implementation, role: Int) -> ByteArray {
  expect Script(hash) = role_address(implementation, role).payment_credential
  hash
}

pub fn valid_implementation(implementation: Implementation) -> Bool {
  and {
    implementation.generation > 0,
    bytearray.length(implementation.compatibility) == 32,
    list.length(implementation.addresses) == role_count,
    list.length(list.unique(implementation.addresses)) == role_count,
    list.all(
      implementation.addresses,
      fn(address) {
        when address.payment_credential is {
          Script(hash) -> bytearray.length(hash) == 28
          _ -> False
        }
      },
    ),
  }
}

pub fn valid_governance(governance: Governance) -> Bool {
  let count = list.length(governance.signers)
  and {
    count > 0 && count <= 7,
    list.length(list.unique(governance.signers)) == count,
    list.all(governance.signers, fn(key) { bytearray.length(key) == 28 }),
    governance.quorum > 0 && governance.quorum <= count,
    governance.delay_ms >= minimum_delay_ms,
  }
}

pub fn authorized(governance: Governance, transaction: Transaction) -> Bool {
  list.count(
    governance.signers,
    fn(key) { list.has(transaction.extra_signatories, key) },
  ) >= governance.quorum
}

pub fn contains(output: Output, token: AuthToken) -> Bool {
  assets.quantity_of(output.value, token.policy_id, token.name) == 1
}

pub fn unique_input(inputs: List<Input>, token: AuthToken) -> Input {
  expect [input, ..rest] = inputs
  if contains(input.output, token) {
    // Preserve the exact-one rule without allocating a filtered input list.
    expect !list.any(rest, fn(other) { contains(other.output, token) })
    input
  } else {
    unique_input(rest, token)
  }
}

pub fn unique_output(outputs: List<Output>, token: AuthToken) -> Output {
  expect [output] = list.filter(outputs, fn(output) { contains(output, token) })
  output
}

// Ordinary work MUST reference (not spend) the registry. This excludes a
// Begin/Rotate transaction piggybacking on an operation seeing the old phase.
pub fn active_registry(
  transaction: Transaction,
  registry_policy: ByteArray,
) -> ActiveRegistry {
  let token =
    AuthToken { policy_id: registry_policy, name: registry_token_name }
  let input = unique_input(transaction.reference_inputs, token)
  // NFT custody and the registry mint/spend validators establish the complete
  // shape. Decode only fields used by normal operations to keep large existing
  // validators publishable. No operator-supplied datum is accepted here.
  let fields =
    builtin.un_constr_data(validator_utils.get_inline_datum(input.output)).2nd
  expect [token_data, host_data, identity_data, ..tail] = fields
  // tail_list fails on a short prefix; the exact suffix still enforces eight
  // fields, without decoding the unused governance/nonce cells.
  expect [current_data,
    phase_data, emergency_data] = builtin.tail_list(builtin.tail_list(tail))
  expect recorded_token: AuthToken = token_data
  expect recorded_token == token
  let host_policy = builtin.un_b_data(host_data)
  expect [generation_data,
    addresses_data, _] = builtin.un_constr_data(current_data).2nd
  let current =
    OperationalImplementation {
      generation: builtin.un_i_data(generation_data),
      addresses: builtin.un_list_data(addresses_data),
    }
  let phase = builtin.un_constr_data(phase_data).1st
  expect phase == 0 || phase == 1
  expect [client_data,
    connection_data,
    channel_data, escrow_data, _] = builtin.un_constr_data(identity_data).2nd
  let client_policy = builtin.un_b_data(client_data)
  let connection_policy = builtin.un_b_data(connection_data)
  let channel_policy = builtin.un_b_data(channel_data)
  let escrow_policy = builtin.un_b_data(escrow_data)
  expect [mask_data,
    _] =
    builtin.tail_list(
      builtin.tail_list(builtin.un_constr_data(emergency_data).2nd),
    )
  ActiveRegistry {
    restrictions: builtin.un_i_data(mask_data),
    preparing: phase == 1,
    host_policy,
    current,
    identity: OperationalIdentity {
      client_policy,
      connection_policy,
      channel_policy,
      escrow_policy,
    },
  }
}

pub fn active_spend(
  transaction: Transaction,
  registry_policy: ByteArray,
  generation: Int,
  role: Int,
  own_ref: OutputReference,
) -> ActiveRegistry {
  let registry = active_registry(transaction, registry_policy)
  expect registry.current.generation == generation
  expect Some(input) = transaction.find_input(transaction.inputs, own_ref)
  let address: Data = input.output.address
  expect address == active_role_address(registry.current, role)
  registry
}

pub fn is_migration(redeemer: Data) -> Bool {
  redeemer == builtin.constr_data(migration_spend_tag, [])
}

// The immutable registry validates the entire transaction and the exact move.
// Requiring its authenticated input is independent of ordinary IBC logic.
pub fn migration_witness(
  transaction: Transaction,
  registry_policy: ByteArray,
) -> Bool {
  let token =
    AuthToken { policy_id: registry_policy, name: registry_token_name }
  let input = unique_input(transaction.inputs, token)
  expect Some(_) =
    pairs.get_first(transaction.redeemers, Spend(input.output_reference))
  assets.quantity_of(transaction.mint, registry_policy, registry_token_name) == 0
}

pub fn no_burn(transaction: Transaction, policy: ByteArray) -> Bool {
  assets.tokens(transaction.mint, policy)
    |> dict.values
    |> list.all(fn(quantity) { quantity > 0 })
}

// The immutable NFT custody validates the full Address shape. Comparing its
// encoded Data retains every address component without duplicating a recursive
// decoder in each near-limit production validator.
pub fn active_role_address(
  current: OperationalImplementation,
  role: Int,
) -> Data {
  expect Some(address) = list.at(current.addresses, role)
  address
}

pub fn active_role_hash(
  current: OperationalImplementation,
  role: Int,
) -> ByteArray {
  let address = active_role_address(current, role)
  let credential = builtin.head_list(builtin.un_constr_data(address).2nd)
  builtin.un_b_data(builtin.head_list(builtin.un_constr_data(credential).2nd))
}

pub fn creation_address(
  transaction: Transaction,
  current: OperationalImplementation,
  role: Int,
) -> Bool {
  let credential = Script(active_role_hash(current, role))
  expect [output] =
    list.filter(
      transaction.outputs,
      fn(output) { output.address.payment_credential == credential },
    )
  let actual: Data = output.address
  actual == active_role_address(current, role)
}

// A mint-only view avoids decoding generation, escrow and authority fields in
// the near-limit channel policy. NFT custody authenticates their omitted shape.
pub fn channel_creation_context(
  transaction: Transaction,
  registry_policy: ByteArray,
) -> (ByteArray, ByteArray, ByteArray, Data) {
  let input =
    unique_input(
      transaction.reference_inputs,
      AuthToken { policy_id: registry_policy, name: registry_token_name },
    )
  expect [_,
    host,
    identity,
    _,
    _,
    current,
    phase,
    _] =
    builtin.un_constr_data(validator_utils.get_inline_datum(input.output)).2nd
  expect builtin.un_constr_data(phase).1st == 0
  expect [client, connection, _, _, _] = builtin.un_constr_data(identity).2nd
  expect [_, addresses, _] = builtin.un_constr_data(current).2nd
  expect Some(address) = list.at(builtin.un_list_data(addresses), 3)
  (
    builtin.un_b_data(host),
    builtin.un_b_data(client),
    builtin.un_b_data(connection),
    address,
  )
}

pub fn encoded_address_hash(address: Data) -> ByteArray {
  builtin.un_b_data(
    builtin.head_list(
      builtin.un_constr_data(
        builtin.head_list(builtin.un_constr_data(address).2nd),
      ).2nd,
    ),
  )
}

pub fn exact_creation_address(transaction: Transaction, address: Data) -> Bool {
  let credential = Script(encoded_address_hash(address))
  expect [output] =
    list.filter(
      transaction.outputs,
      fn(output) { output.address.payment_credential == credential },
    )
  let actual: Data = output.address
  actual == address
}

pub fn preserved_output(input: Input, output: Output, address: Address) -> Bool {
  and {
    output.address == address,
    output.datum == input.output.datum,
    output.reference_script == input.output.reference_script,
    validator_utils.preserves_state_value(input.output.value, output.value),
  }
}

pub fn valid_authority(authority: Authority) -> Bool {
  let count = list.length(authority.signers)
  and {
    count > 0 && count <= 7,
    list.length(list.unique(authority.signers)) == count,
    list.all(authority.signers, fn(key) { bytearray.length(key) == 28 }),
    authority.quorum > 0 && authority.quorum <= count,
  }
}

pub fn emergency_authorized(
  authority: Authority,
  transaction: Transaction,
) -> Bool {
  list.count(
    authority.signers,
    fn(key) { list.has(transaction.extra_signatories, key) },
  ) >= authority.quorum
}

pub fn separate_authorities(
  governance: Governance,
  authority: Authority,
) -> Bool {
  !list.any(authority.signers, fn(key) { list.has(governance.signers, key) })
}

pub fn permitted(mask: Int, bit: Int) -> Bool {
  mask / bit % 2 == 0
}

pub fn valid_mask(mask: Int) -> Bool {
  mask >= 0 && mask <= 15
}

pub fn tightens(old: Int, new: Int) -> Bool {
  valid_mask(new) && list.all(
    [1, 2, 4, 8],
    fn(bit) { permitted(old, bit) || !permitted(new, bit) },
  )
}

// Compact direct gate in each replaceable spending wrapper. This remains
// effective when an ordinary dispatch path erroneously omits HostState coupling.
pub fn operation_allowed(
  transaction: Transaction,
  policy: ByteArray,
  generation: Int,
  bit: Int,
) -> Bool {
  let input =
    unique_input(
      transaction.reference_inputs,
      AuthToken { policy_id: policy, name: registry_token_name },
    )
  let fields =
    builtin.un_constr_data(validator_utils.get_inline_datum(input.output)).2nd
  expect [current,
    phase,
    emergency] =
    builtin.tail_list(
      builtin.tail_list(
        builtin.tail_list(builtin.tail_list(builtin.tail_list(fields))),
      ),
    )
  expect [current_generation, _, _] = builtin.un_constr_data(current).2nd
  expect [mask,
    _] =
    builtin.tail_list(builtin.tail_list(builtin.un_constr_data(emergency).2nd))
  and {
    builtin.un_constr_data(phase).1st <= 1,
    builtin.un_i_data(current_generation) == generation,
    permitted(builtin.un_i_data(mask), bit),
  }
}
