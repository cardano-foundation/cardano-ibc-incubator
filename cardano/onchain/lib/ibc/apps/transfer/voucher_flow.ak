use aiken/collection/pairs
use cardano/assets.{PolicyId}
use cardano/transaction.{Mint, Redeemer, ScriptPurpose}
use ibc/apps/transfer/mint_voucher_redeemer.{
  BurnVoucher, MintVoucher, MintVoucherRedeemer,
}
use ibc/core/ics_004/types/packet.{Packet}

pub fn require_no_voucher_mint(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  voucher_minting_policy_id: PolicyId,
) -> Bool {
  pairs.get_first(redeemers, Mint(voucher_minting_policy_id)) == None
}

pub fn validate_mint_voucher_packet(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  voucher_minting_policy_id: PolicyId,
  packet: Packet,
) -> Bool {
  expect Some(mint_voucher_redeemer) =
    pairs.get_first(redeemers, Mint(voucher_minting_policy_id))
  expect mint_voucher_redeemer: MintVoucherRedeemer = mint_voucher_redeemer
  expect MintVoucher {
    packet_source_port,
    packet_source_channel,
    packet_dest_port,
    packet_dest_channel,
    ..
  } = mint_voucher_redeemer

  and {
    (packet_source_port == packet.source_port)?,
    (packet_source_channel == packet.source_channel)?,
    (packet_dest_port == packet.destination_port)?,
    (packet_dest_channel == packet.destination_channel)?,
  }
}

pub fn validate_burn_voucher_packet(
  redeemers: Pairs<ScriptPurpose, Redeemer>,
  voucher_minting_policy_id: PolicyId,
  packet: Packet,
) -> Bool {
  expect Some(mint_voucher_redeemer) =
    pairs.get_first(redeemers, Mint(voucher_minting_policy_id))
  expect mint_voucher_redeemer: MintVoucherRedeemer = mint_voucher_redeemer
  expect BurnVoucher { packet_source_port, packet_source_channel, .. } =
    mint_voucher_redeemer

  and {
    (packet_source_port == packet.source_port)?,
    (packet_source_channel == packet.source_channel)?,
  }
}
