use cardano/transaction.{OutputReference, Transaction}
use ibc/core/ics_004/channel_datum.{ChannelDatum}
use ibc/core/ics_004/channel_redeemer.{ReclaimChannel, SpendChannelRedeemer}
use ibc/core/ics_004/packet_shutdown
use ibc/implementation/spending_channel
use ibc/migration/auth as migration

validator channel(
  registry_policy: ByteArray,
  generation: Int,
  host_policy: ByteArray,
  operations: List<ByteArray>,
  packet_config_policy: ByteArray,
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
      expect
        migration.operation_allowed(transaction, registry_policy, generation, 1)
      expect redeemer: SpendChannelRedeemer = raw
      expect
        if redeemer == ReclaimChannel {
          expect Some(channel_datum) = datum
          channel_datum.port_id != "transfer" || packet_shutdown.channel_drained(
            transaction,
            packet_config_policy,
            channel_datum,
          )
        } else {
          True
        }
      expect [
        open_ack, open_confirm, close_init, close_confirm, recv, send, timeout,
        ack, prune, upgrade, upgrade_handshake, upgrade_finish,
      ] = operations
      spending_channel.validate(
        True,
        open_ack,
        open_confirm,
        close_init,
        close_confirm,
        recv,
        send,
        timeout,
        ack,
        prune,
        upgrade,
        upgrade_handshake,
        upgrade_finish,
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
