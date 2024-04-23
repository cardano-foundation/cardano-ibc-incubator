use aiken/dict
use ibc/client/ics_007_tendermint_client/client_datum.{ClientDatumState}
use ibc/client/ics_007_tendermint_client/client_state
use ibc/client/ics_007_tendermint_client/cometbft/protos/channel_pb
use ibc/client/ics_007_tendermint_client/height
use ibc/core/ics_003_connection_semantics/types/connection_end.{ConnectionEnd}
use ibc/core/ics_003_connection_semantics/types/params
use ibc/core/ics_003_connection_semantics/verify_proof_redeemer.{
  VerifyChannelState, VerifyPacketAcknowledgement, VerifyPacketCommitment,
  VerifyPacketReceiptAbsence, VerifyProofRedeemer,
}
use ibc/core/ics_004/types/acknowledgement as acknowledgement_mod
use ibc/core/ics_004/types/channel
use ibc/core/ics_023_vector_commitments/merkle
use ibc/core/ics_024_host_requirements/channel_keys
use ibc/core/ics_024_host_requirements/packet_keys
use ibc/utils/math

validator {
  fn verify_proof(redeemer: VerifyProofRedeemer, _context: Data) -> Bool {
    when redeemer is {
      VerifyChannelState {
        client_datum_state,
        connection,
        port_id,
        channel_id,
        proof,
        proof_height,
        channel,
      } -> {
        let merkle_path =
          merkle.apply_prefix(
            connection.counterparty.prefix,
            merkle.new_merkle_path(
              [channel_keys.channel_path(port_id, channel_id)],
            ),
          )
        expect Some(consensus_state) =
          dict.from_list(client_datum_state.consensus_states, height.compare)
            |> dict.get(proof_height)
        client_state.verify_membership(
          client_datum_state.client_state,
          consensus_state,
          proof_height,
          0,
          0,
          proof,
          merkle_path,
          channel_pb.marshal_for_channel(
            Some(channel.convert_to_channel_proto(channel)),
          ),
        )
      }

      VerifyPacketCommitment {
        client_datum_state,
        connection,
        proof_height,
        proof,
        port_id,
        channel_id,
        sequence,
        commitment_bytes,
      } -> {
        let time_delay = connection.delay_period
        let block_delay = get_block_delay(connection)
        let merkle_path =
          merkle.apply_prefix(
            connection.counterparty.prefix,
            merkle.new_merkle_path(
              [
                packet_keys.packet_commitment_path(
                  port_id,
                  channel_id,
                  sequence,
                ),
              ],
            ),
          )
        expect Some(consensus_state) =
          dict.from_list(client_datum_state.consensus_states, height.compare)
            |> dict.get(proof_height)
        client_state.verify_membership(
          client_datum_state.client_state,
          consensus_state,
          proof_height,
          time_delay,
          block_delay,
          proof,
          merkle_path,
          commitment_bytes,
        )
      }

      VerifyPacketAcknowledgement {
        client_datum_state,
        connection,
        proof_height,
        proof,
        port_id,
        channel_id,
        sequence,
        acknowledgement,
      } -> {
        let time_delay = connection.delay_period
        let block_delay = get_block_delay(connection)
        let merkle_path =
          merkle.apply_prefix(
            connection.counterparty.prefix,
            merkle.new_merkle_path(
              [
                packet_keys.packet_acknowledgement_path(
                  port_id,
                  channel_id,
                  sequence,
                ),
              ],
            ),
          )

        expect Some(consensus_state) =
          dict.from_list(client_datum_state.consensus_states, height.compare)
            |> dict.get(proof_height)

        let commit_ack =
          acknowledgement_mod.commit_acknowledgement(acknowledgement)

        client_state.verify_membership(
          client_datum_state.client_state,
          consensus_state,
          proof_height,
          time_delay,
          block_delay,
          proof,
          merkle_path,
          commit_ack,
        )
      }

      VerifyPacketReceiptAbsence {
        client_datum_state,
        connection,
        proof_height,
        proof,
        port_id,
        channel_id,
        sequence,
      } -> {
        let time_delay = connection.delay_period
        let block_delay = get_block_delay(connection)
        let merkle_path =
          merkle.apply_prefix(
            connection.counterparty.prefix,
            merkle.new_merkle_path(
              [packet_keys.packet_receipt_path(port_id, channel_id, sequence)],
            ),
          )
        expect Some(consensus_state) =
          dict.from_list(client_datum_state.consensus_states, height.compare)
            |> dict.get(proof_height)
        client_state.verify_non_membership(
          client_datum_state.client_state,
          consensus_state,
          proof_height,
          time_delay,
          block_delay,
          proof,
          merkle_path,
        )
      }

      _ -> False
    }
  }
}

fn get_block_delay(connection: ConnectionEnd) -> Int {
  let expected_time_per_block = params.max_expected_time_per_block
  let time_delay = connection.delay_period
  math.ceil_divide_uinteger(time_delay, expected_time_per_block)
}
