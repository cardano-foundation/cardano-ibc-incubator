#!/usr/bin/env bash
set -euo pipefail

repo_root=${1:?usage: collect-cardano-tx-budget-units.sh REPO_ROOT OUTPUT_JSON}
output_json=${2:?usage: collect-cardano-tx-budget-units.sh REPO_ROOT OUTPUT_JSON}

cd "$repo_root/cardano/onchain"
aiken check \
  --deny \
  --trace-level silent \
  --plain-numbers \
  --exact-match \
  -m 'ibc/core/ics_003_connection_semantics/connection_datum.{test_is_conn_open_try_valid_succeed}' \
  -m 'spending_transfer_module.{on_chan_open_try_succeed}' \
  -m 'spending_connection.{conn_open_ack_accepts_authenticated_history_witness}' \
  -m 'spending_channel.{send_packet_succeed}' \
  -m 'spending_channel/send_packet.{succeed_send_packet}' \
  -m 'ibc/core/ics_004/channel_datum_test/validate_send_packet.{succeed_at_packet_commitment_capacity}' \
  -m 'host_state_stt.{host_state_handle_packet_send_succeeds_at_commitment_capacity}' \
  -m 'spending_transfer_module.{transfer_escrow_succeed}' \
  -m 'minting_transfer_escrow_shard.{create_transfer_escrow_shard_succeeds}' \
  -m 'spending_channel.{recv_packet_succeed}' \
  -m 'spending_channel/recv_packet.{succeed_recv_packet}' \
  -m 'ibc/core/ics_004/channel_datum_test/validate_recv_packet.{succeed_at_packet_history_capacity}' \
  -m 'host_state_stt.{host_state_handle_packet_recv_succeeds_at_history_capacity}' \
  -m 'host_state_stt.{host_state_handle_packet_acknowledgement_succeeds_at_history_capacity}' \
  -m 'verifying_proof.{verify_membership_succeed}' \
  -m 'spending_channel/recv_packet.{succeed_recv_packet_maximum_ics20_packet}' \
  -m 'spending_transfer_module.{on_recv_packet_mint_voucher_maximum_ics20_packet_succeed}' \
  -m 'spending_transfer_module.{on_recv_packet_mint_voucher_maximum_v8_ics20_packet_succeed}' \
  -m 'minting_voucher.{test_mint_voucher_maximum_v10_ics20_packet_with_eight_archives_at_entry_limit}' \
  -m 'minting_voucher.{test_mint_voucher_maximum_v10_ics20_packet_with_eight_archives_near_byte_limit}' \
  -m 'minting_voucher.{test_mint_voucher_maximum_v8_ics20_packet_with_eight_archives_at_entry_limit}' \
  -m 'minting_voucher.{test_mint_voucher_maximum_v8_ics20_packet_with_eight_archives_near_byte_limit}' \
  -m 'spending_channel.{prune_packet_history_succeed}' \
  -m 'spending_channel/prune_packet_history.{prune_packet_history_succeeds_at_capacity_boundary}' \
  -m 'spending_channel/prune_packet_history.{prune_packet_history_accepts_ordered_channel_at_capacity}' \
  -m 'host_state_stt.{host_state_prune_packet_history_succeeds_at_full_packet_history_capacity}' \
  -m 'host_state_stt.{host_state_ordered_prune_succeeds_at_full_packet_history_capacity}' \
  -m 'verifying_proof.{verify_non_membership_succeed}' \
  -m 'spending_channel.{acknowledge_packet_succeed}' \
  -m 'spending_channel/acknowledge_packet.{succeed_acknowledge_packet}' \
  -m 'spending_transfer_module.{on_acknowledgement_packet_result_succeed}' \
  -m 'spending_channel.{timeout_packet_succeed}' \
  -m 'spending_channel/timeout_packet.{succeed_timeout_unordered_packet}' \
  -m 'spending_transfer_module.{on_timeout_packet_mint_voucher_succeed}' \
  -m 'trace_registry.{trace_registry_insert_trace_succeeds_with_matching_voucher_mint}' \
  -m 'trace_registry_rollover.{trace_registry_rollover_insert_succeeds_and_preserves_old_shard}' \
  -m 'trace_registry_rollover.{trace_registry_advance_directory_succeeds_for_valid_rollover}' \
  -m 'trace_registry_capacity.{trace_registry_boundary_append_eight_archives_at_entry_limit}' \
  -m 'trace_registry_capacity.{trace_registry_boundary_append_eight_archives_near_byte_limit}' \
  -m 'host_state_stt.{host_state_bind_tenth_port_succeeds_at_global_cap}' \
  -m 'host_state_stt.{host_update_client_capacity_minimum_history_succeeds}' \
  -m 'recover_client.{recover_client_accepts_expired_subject}' \
  -m 'recover_client.{spend_client_forwards_valid_recovery}' \
  -m 'spending_client_capacity.{update_client_capacity_adjacent_all_signed_45_succeeds}' \
  -m 'spending_client_capacity.{update_client_capacity_adjacent_mixed_45_succeeds}' \
  -m 'spending_client_capacity.{update_client_capacity_non_adjacent_mixed_45_succeeds}' \
  -m 'spending_client_capacity.{support_capacity_adjacent_all_signed_45_succeeds}' \
  -m 'spending_client_capacity.{support_capacity_adjacent_mixed_45_succeeds}' \
  -m 'spending_client_capacity.{support_capacity_non_adjacent_mixed_45_succeeds}' \
  -m 'minting_port.{mint_port_tenth_port_succeeds_at_module_cap}' \
  -m 'minting_identifier.{mints_identifier_from_nonce_output_reference}' \
  -m 'host_state_stt.{host_update_client_capacity_fixture_setup_baseline}' \
  -m 'recover_client.{staged_atomic_freeze_fixture_setup_baseline}' \
  -m 'recover_client.{staged_atomic_freeze_all_validators_accept_real_root_transition}' \
  -m 'recover_client.{staged_atomic_recovery_fixture_setup_baseline}' \
  -m 'recover_client.{staged_atomic_recovery_all_validators_accept_real_root_transition}' \
  -m 'minting_tendermint_update_session.{session_mint_fixture_setup_baseline}' \
  -m 'minting_tendermint_update_session.{mints_one_seed_bound_session_with_exact_initial_datum}' \
  -m 'minting_tendermint_update_session.{session_burn_fixture_setup_baseline}' \
  -m 'minting_tendermint_update_session.{burns_only_a_token_carried_by_the_session_script}' \
  -m 'spending_tendermint_update_session.{real_injective_six_validator_fixture_setup_baseline}' \
  -m 'spending_tendermint_update_session.{advances_real_injective_six_validator_target_batch}' \
  -m 'spending_tendermint_update_session.{real_non_adjacent_six_membership_fixture_setup_baseline}' \
  -m 'spending_tendermint_update_session.{advances_real_non_adjacent_six_membership_target_batch}' \
  -m 'spending_tendermint_update_session.{depth_eight_non_adjacent_six_membership_fixture_setup_baseline}' \
  -m 'spending_tendermint_update_session.{advances_depth_eight_non_adjacent_six_membership_target_batch}' \
  -m 'spending_tendermint_update_session.{session_finalize_fixture_setup_baseline}' \
  -m 'spending_tendermint_update_session.{complete_session_requires_client_and_host_threads_and_burn}' \
  -m 'spending_multitx_client.{completed_session_update_fixture_setup_baseline}' \
  -m 'spending_multitx_client.{completed_session_updates_the_client_atomically}' \
  > "$output_json"
