import {
  MessagePart,
  MithrilCertificate,
  MithrilStakeDistribution,
  ProtocolMessagePartKey,
  SignedEntityType,
} from '@plus/proto-types/build/ibc/lightclients/mithril/v1/mithril';
import { getNanoseconds } from './time';
import { doubleToFraction } from './number';
import { convertHex2String } from './hex';

export function normalizeMithrilStakeDistribution(
  stakeDistribution: any,
  stakeDistributionCertificate: any,
): MithrilStakeDistribution {
  let mithrilStakeDistribution: MithrilStakeDistribution = {
    epoch: BigInt(stakeDistribution.epoch),
    hash: stakeDistribution.hash,
    certificate_hash: stakeDistribution.certificate_hash,
    signers_with_stake: stakeDistributionCertificate.metadata.signers ?? [],
    created_at:
      BigInt(new Date(stakeDistribution.created_at).valueOf()) * 10n ** 9n +
      BigInt(getNanoseconds(stakeDistribution.created_at)),
    protocol_parameter: {
      k: BigInt(stakeDistributionCertificate.metadata.parameters.k),
      m: BigInt(stakeDistributionCertificate.metadata.parameters.m),
      phi_f: {
        numerator: BigInt(doubleToFraction(stakeDistributionCertificate.metadata.parameters.phi_f).numerator),
        denominator: BigInt(doubleToFraction(stakeDistributionCertificate.metadata.parameters.phi_f).denominator),
      },
    },
  };
  return mithrilStakeDistribution;
}

export function normalizeMithrilStakeDistributionCertificate(
  stakeDistribution: any,
  stakeDistributionCertificate: any,
): MithrilCertificate {
  let stakeDistributionSignedEntityType: SignedEntityType = {};
  if (stakeDistributionCertificate.signed_entity_type.hasOwnProperty('MithrilStakeDistribution'))
    stakeDistributionSignedEntityType.mithril_stake_distribution = normalizeMithrilStakeDistribution(
      stakeDistribution,
      stakeDistributionCertificate,
    );

  if (stakeDistributionCertificate.signed_entity_type.hasOwnProperty('CardanoImmutableFilesFull'))
    stakeDistributionSignedEntityType.cardano_immutable_files_full = {
      beacon: {
        network: stakeDistributionCertificate.signed_entity_type.CardanoImmutableFilesFull.network,
        epoch: BigInt(stakeDistributionCertificate.signed_entity_type.CardanoImmutableFilesFull.epoch),
        immutable_file_number: BigInt(
          stakeDistributionCertificate.signed_entity_type.CardanoImmutableFilesFull.immutable_file_number,
        ),
      },
    };
  if (stakeDistributionCertificate.signed_entity_type.hasOwnProperty('CardanoTransactions'))
    stakeDistributionSignedEntityType.cardano_transactions = {
      epoch: BigInt(stakeDistributionCertificate.signed_entity_type.CardanoTransactions?.[0] ?? 0),
      block_number: BigInt(stakeDistributionCertificate.signed_entity_type.CardanoTransactions?.[1] ?? 0),
    };
  if (stakeDistributionCertificate.signed_entity_type.hasOwnProperty('CardanoImmutableFilesFull'))
    stakeDistributionSignedEntityType.cardano_immutable_files_full = {
      beacon: {
        network: stakeDistributionCertificate.signed_entity_type.CardanoImmutableFilesFull.network,
        epoch: BigInt(stakeDistributionCertificate.signed_entity_type.CardanoImmutableFilesFull.epoch),
        immutable_file_number: BigInt(
          stakeDistributionCertificate.signed_entity_type.CardanoImmutableFilesFull.immutable_file_number,
        ),
      },
    };

  let messageParts: MessagePart[] = [];
  if (stakeDistributionCertificate.protocol_message.message_parts) {
    messageParts = Object.keys(stakeDistributionCertificate.protocol_message.message_parts).map((key) => {
      let protocolMessagePartKey: ProtocolMessagePartKey = ProtocolMessagePartKey.UNRECOGNIZED;
      if (key === 'next_aggregate_verification_key')
        protocolMessagePartKey = ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_NEXT_AGGREGATE_VERIFICATION_KEY;
      if (key === 'snapshot_digest')
        protocolMessagePartKey = ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_SNAPSHOT_DIGEST;
      if (key === 'cardano_transactions_merkle_root')
        protocolMessagePartKey = ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_CARDANO_TRANSACTIONS_MERKLE_ROOT;
      if (key === 'latest_immutable_file_number')
        protocolMessagePartKey = ProtocolMessagePartKey.PROTOCOL_MESSAGE_PART_KEY_LATEST_IMMUTABLE_FILE_NUMBER;

      return {
        protocol_message_part_key: protocolMessagePartKey,
        protocol_message_part_value: stakeDistributionCertificate.protocol_message.message_parts[key],
      } as MessagePart;
    });
  }

  let multiSignature = stakeDistributionCertificate.multi_signature
    ? JSON.parse(convertHex2String(stakeDistributionCertificate.multi_signature))
    : null;

  return {
    hash: stakeDistributionCertificate.hash,
    previous_hash: stakeDistributionCertificate.previous_hash,
    epoch: BigInt(stakeDistributionCertificate.epoch),
    signed_entity_type: stakeDistributionSignedEntityType,
    metadata: {
      network: stakeDistributionCertificate.metadata.network,
      protocol_version: stakeDistributionCertificate.metadata.version,
      protocol_parameters: {
        k: BigInt(stakeDistributionCertificate.metadata.parameters.k),
        m: BigInt(stakeDistributionCertificate.metadata.parameters.m),
        phi_f: {
          numerator: BigInt(doubleToFraction(stakeDistributionCertificate.metadata.parameters.phi_f).numerator),
          denominator: BigInt(doubleToFraction(stakeDistributionCertificate.metadata.parameters.phi_f).denominator),
        },
      },
      initiated_at: stakeDistributionCertificate.metadata.initiated_at,
      sealed_at: stakeDistributionCertificate.metadata.sealed_at,
      signers: stakeDistributionCertificate.metadata.signers ?? [],
    },
    protocol_message: {
      message_parts: messageParts,
    },
    signed_message: stakeDistributionCertificate.signed_message,
    aggregate_verification_key: stakeDistributionCertificate.aggregate_verification_key,
    genesis_signature: stakeDistributionCertificate.genesis_signature,
    multi_signature: stakeDistributionCertificate.multi_signature,
  } as MithrilCertificate;
}
