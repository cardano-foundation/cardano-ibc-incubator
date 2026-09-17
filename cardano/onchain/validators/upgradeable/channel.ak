use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{ReclaimChannel, SpendChannelRedeemer}
use ibc/implementation/spending_channel
use ibc/migration/auth as migration

validator channel(
  registry_policy: ByteArray,
  generation: Int,
  host_policy: ByteArray,
  operations: List<ByteArray>,
) {
  spend(
    datum: Option<ChannelDatum>,
    raw: Data,
    own_ref: OutputReference,
    transaction: Transaction,
  ) {
    if migration.is_migration(raw) {
      migration.migration_witness(transaction, registry_policy)
    } else {
      // Ordinary operations consume HostState, whose current registry gate
      // authenticates phase and role compatibility. Migration has a separate path.
      expect generation > 0
      expect redeemer: SpendChannelRedeemer = raw
      expect redeemer != ReclaimChannel
      expect [
        open_ack, open_confirm, close_init, close_confirm, recv, send, timeout,
        ack, prune,
      ] = operations
      spending_channel.validate(
        False,
        open_ack,
        open_confirm,
        close_init,
        close_confirm,
        recv,
        send,
        timeout,
        ack,
        prune,
        host_policy,
        datum,
        redeemer,
        own_ref,
        transaction,
      )
    }
  }

  else(_) {
    fail
  }
}
