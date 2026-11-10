use aiken/collection/list
use aiken/crypto
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/transaction.{Transaction}
use ibc/apps/transfer/packet_batch.{
  Acknowledge, BatchOperation, Receive, Reject, SendBatch, Timeout,
  TimeoutOnClose, TransferIntent,
}
use ibc/apps/transfer/types/coin
use ibc/core/ics_004/packet_lane_datum.{PacketLaneDatum}
use ibc/utils/validator_utils

fn add(
  balances: Pairs<ByteArray, Int>,
  denom: ByteArray,
  amount: Int,
) -> Pairs<ByteArray, Int> {
  update_sorted(balances, crypto.sha2_256(denom), amount)
}

// Authenticated lanes start empty. Packet callbacks and balance compaction
// preserve unique keys in ascending order. Keep zero reservations until the
// existing settlement filter below releases them.
fn update_sorted(balances, denom, amount) {
  when balances is {
    [] -> [Pair(denom, amount)]
    [Pair(key, previous) as entry, ..rest] ->
      when bytearray.compare(key, denom) is {
        Less -> [entry, ..update_sorted(rest, denom, amount)]
        Equal -> [Pair(key, previous + amount), ..rest]
        Greater -> [Pair(denom, amount), entry, ..rest]
      }
  }
}

pub fn balance_after(
  transaction: Transaction,
  old: PacketLaneDatum,
  op: BatchOperation,
) -> Pairs<ByteArray, Int> {
  // Outstanding sends reserve their asset slots, including zero balances.
  // Maintenance cannot move these reservations until all sends settle.
  let pending =
    when op is {
      SendBatch { .. } -> True
      Acknowledge { .. } |
      Timeout { .. } |
      TimeoutOnClose { .. } |
      Reject { .. } -> list.length(old.commitments) > 1
      _ -> old.commitments != []
    }
  let balances =
    when op is {
      SendBatch { intents, packets, .. } ->
        list.foldl(
          list.zip(intents, packets),
          old.balances,
          fn(pair, balances) {
            let (intent_ref, packet) = pair
            if packet.sequence % old.lane_count == old.lane {
              expect intent: TransferIntent =
                validator_utils.get_inline_datum(
                  packet_batch.input_at(transaction, intent_ref).output,
                )
              expect Some(amount) = int.from_utf8(intent.data.amount)
              add(
                balances,
                intent.data.denom,
                if coin.sender_chain_is_source(
                  old.port_id,
                  old.channel_id,
                  intent.data.denom,
                ) {
                  amount
                } else {
                  -amount
                },
              )
            } else {
              balances
            }
          },
        )
      Receive { packet, data, .. } -> {
        expect Some(amount) = int.from_utf8(data.amount)
        if coin.receiver_chain_is_source(
          packet.source_port,
          packet.source_channel,
          data.denom,
        ) {
          let prefix =
            coin.get_denom_prefix(packet.source_port, packet.source_channel)
          add(
            old.balances,
            bytearray.drop(data.denom, bytearray.length(prefix)),
            -amount,
          )
        } else {
          add(
            old.balances,
            bytearray.concat(
              coin.get_denom_prefix(old.port_id, old.channel_id),
              data.denom,
            ),
            amount,
          )
        }
      }
      Timeout { data, .. } | TimeoutOnClose { data, .. } | Reject { data, .. } -> {
        expect Some(amount) = int.from_utf8(data.amount)
        add(
          old.balances,
          data.denom,
          if coin.sender_chain_is_source(
            old.port_id,
            old.channel_id,
            data.denom,
          ) {
            -amount
          } else {
            amount
          },
        )
      }
      _ -> old.balances
    }
  if pending {
    balances
  } else {
    list.filter(balances, fn(entry) { entry.2nd != 0 })
  }
}
