// IBC Host State - Single Token Thread (STT) Validator
//
// This validator enforces the Single Token Thread pattern for IBC host state:
// 1. Exactly ONE UTXO with the IBC Host State NFT exists at any time
// 2. State updates MUST spend the old UTXO and create a new one with the same NFT
// 3. Version MUST increment monotonically (forward-only progression)
// 4. State transitions MUST be valid for the operation type
//
// Security properties:
// - Canonical state: Only one valid state exists at any height
// - No rollback: Version monotonicity prevents replaying old state
// - Type safety: Redeemer specifies operation, validator checks validity
// - Auditability: NFT provides complete state history

use aiken/collection/list
use aiken/primitive/bytearray
use aiken/transaction.{InlineDatum, Input, Output, ScriptContext, Transaction}
use aiken/transaction/value.{AssetName, PolicyId}
use ibc/core/ics_025_handler_interface/host_state.{
  HostState, HostStateDatum, host_state_token_name, validate_bind_port,
  validate_create_channel, validate_create_client, validate_create_connection,
  validate_version_increment,
}

/// Redeemer for HostState STT operations
pub type HostStateRedeemer {
  /// Create a new IBC client
  CreateClient
  /// Create a new IBC connection
  CreateConnection
  /// Create a new IBC channel
  CreateChannel
  /// Bind a port
  BindPort { port: Int }
  /// Update client state (consensus update, misbehaviour, upgrade)
  UpdateClient
  /// Update connection state (handshake continuation)
  UpdateConnection
  /// Update channel state (handshake continuation)
  UpdateChannel
  /// Send/receive IBC packets
  HandlePacket
}

/// Find the HostState UTXO input being spent
/// 
/// Returns the input that contains the IBC Host State NFT
fn find_host_state_input(
  inputs: List<Input>,
  nft_policy: PolicyId,
) -> Option<Input> {
  list.find(
    inputs,
    fn(input) {
      let quantity =
        value.quantity_of(
          input.output.value,
          nft_policy,
          host_state_token_name,
        )
      quantity == 1
    },
  )
}

/// Find the HostState UTXO output being created
/// 
/// Returns the output that contains the IBC Host State NFT
fn find_host_state_output(
  outputs: List<Output>,
  nft_policy: PolicyId,
) -> Option<Output> {
  list.find(
    outputs,
    fn(output) {
      let quantity =
        value.quantity_of(output.value, nft_policy, host_state_token_name)
      quantity == 1
    },
  )
}

/// Decode HostStateDatum from inline datum
fn decode_host_state_datum(output: Output) -> HostStateDatum {
  expect InlineDatum(datum) = output.datum
  expect decoded_datum: HostStateDatum = datum
  decoded_datum
}

/// Main validator for HostState STT
/// 
/// Enforces:
/// 1. Exactly one input with NFT (the old state)
/// 2. Exactly one output with NFT (the new state)
/// 3. NFT is preserved (not burned or duplicated)
/// 4. Version increments by 1
/// 5. State transition is valid for the operation
validator host_state_stt(nft_policy: PolicyId) {
  spend(
    datum_opt: Option<HostStateDatum>,
    redeemer: HostStateRedeemer,
    _own_ref: Data,
    ctx: ScriptContext,
  ) {
    // 1. Extract transaction
    let ScriptContext { transaction, .. } = ctx
    let Transaction { inputs, outputs, .. } = transaction
    
    // 2. Find input HostState UTXO
    expect Some(host_input) = find_host_state_input(inputs, nft_policy)
    let old_datum = decode_host_state_datum(host_input.output)
    
    // 3. Find output HostState UTXO
    expect Some(host_output) = find_host_state_output(outputs, nft_policy)
    let new_datum = decode_host_state_datum(host_output)
    
    // 4. Verify NFT policy matches
    expect old_datum.nft_policy == nft_policy
    expect new_datum.nft_policy == nft_policy
    
    // 5. Verify exactly one output with NFT (no duplication)
    let nft_output_count =
      list.count(
        outputs,
        fn(output) {
          let quantity =
            value.quantity_of(output.value, nft_policy, host_state_token_name)
          quantity == 1
        },
      )
    expect nft_output_count == 1
    
    // 6. Validate state transition based on operation
    when redeemer is {
      CreateClient -> validate_create_client(old_datum, new_datum)
      
      CreateConnection -> validate_create_connection(old_datum, new_datum)
      
      CreateChannel -> validate_create_channel(old_datum, new_datum)
      
      BindPort { port } -> validate_bind_port(old_datum, new_datum, port)
      
      UpdateClient ->
        // For client updates, only version must increment
        // (client-specific UTXOs handle the actual validation)
        validate_version_increment(old_datum.state, new_datum.state)
      
      UpdateConnection ->
        // For connection updates, only version must increment
        validate_version_increment(old_datum.state, new_datum.state)
      
      UpdateChannel ->
        // For channel updates, only version must increment
        validate_version_increment(old_datum.state, new_datum.state)
      
      HandlePacket ->
        // For packet handling, only version must increment
        validate_version_increment(old_datum.state, new_datum.state)
    }
  }
  
  else(_) {
    fail @"HostState STT can only be spent"
  }
}

