use aiken/collection/list
use aiken/collection/pairs
use aiken/primitive/bytearray
use aiken/primitive/int
use cardano/transaction.{Transaction}
use ibc/apps/transfer/packet_batch.{
  BatchOperation, Receive, Reject, SendBatch, Timeout, TimeoutOnClose,
  TransferIntent,
}
use ibc/apps/transfer/types/coin
use ibc/core/ics_004/packet_lane_datum.{PacketLaneDatum}
use ibc/utils/validator_utils

fn add(
  balances: Pairs<ByteArray, Int>,
  denom: ByteArray,
  amount: Int,
) -> Pairs<ByteArray, Int> {
  let previous =
    when pairs.get_first(balances, denom) is {
      None -> 0
      Some(value) -> value
    }
  let rest = pairs.delete_first(balances, denom)
  if previous + amount == 0 {
    rest
  } else {
    pairs.insert_by_ascending_key(
      rest,
      denom,
      previous + amount,
      bytearray.compare,
    )
  }
}

pub fn balance_after(
  transaction: Transaction,
  old: PacketLaneDatum,
  op: BatchOperation,
) -> Pairs<ByteArray, Int> {
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
        if coin.sender_chain_is_source(old.port_id, old.channel_id, data.denom) {
          -amount
        } else {
          amount
        },
      )
    }
    _ -> old.balances
  }
}
