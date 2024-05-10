export type MithrilClientState = {
  chain_id: string;
  latest_height: MithrilHeight;
  frozen_height: MithrilHeight;
  current_epoch: bigint;
  trusting_period: bigint;
  protocol_parameters: MithrilProtocolParameters;
  upgrade_path: string[];
};

export type MithrilHeight = {
  mithril_height: bigint;
};

export type MithrilProtocolParameters = {
  k: bigint;
  m: bigint;
  phi_f: bigint;
};

export type MithrilConsensusState = {
  timestamp: number;
  mithril_stake_distribution_certificate: MithrilCertificate;
  transaction_snapshot_certificate: MithrilCertificate;
};

export type MithrilCertificate = {
  hash: string;
  previous_hash: string;
  epoch: bigint;
  signed_entity_type: SignedEntityType;
  metadata: CertificateMetadata;
  protocol_message: ProtocolMessage;
  signed_message: string;
  aggregate_verification_key: string;
  signature: CertificateSignature;
};

export type CertificateMetadata = {
  protocol_version: string;
  protocol_parameters: MithrilProtocolParameters;
  initiated_at: bigint;
  sealed_at: bigint;
  signers: SignerWithStake[];
};

export type SignerWithStake = {
  party_id: string;
  stake: bigint;
};

export type ProtocolMessage = {
  protocol_message_part_key: ProtocolMessagePartKey;
  protocol_message_part_value: string;
};

export enum SignedEntityType {
  MITHRIL_STAKE_DISTRIBUTION = 0,
  CARDANO_TRANSACTIONS = 1,
}

export enum ProtocolMessagePartKey {
  SNAPSHOT_DIGEST = 0,
  CARDANO_TRANSACTIONS_MERKLE_ROOT = 1,
  NEXT_AGGREGATE_VERIFICATION_KEY = 2,
  LATEST_IMMUTABLE_FILE_NUMBER = 3,
}

export enum CertificateSignature {
  GENESIS_SIGNATURE = 0,
  MULTI_SIGNATURE = 1,
}
