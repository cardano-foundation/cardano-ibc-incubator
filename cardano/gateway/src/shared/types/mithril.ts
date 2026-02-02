export type MithrilClientState = {
  chain_id: string;
  host_state_nft_policy_id: string;
  host_state_nft_token_name: string;
  latest_height: MithrilHeight;
  frozen_height: MithrilHeight;
  current_epoch: bigint;
  trusting_period: bigint;
  protocol_parameters: MithrilProtocolParameters;
  upgrade_path: string[];
};

export type MithrilHeight = {
  revisionNumber: bigint;
  revisionHeight: bigint;
};

export type MithrilProtocolParameters = {
  k: bigint;
  m: bigint;
  phi_f: Fraction;
};

export type Fraction = {
  numerator: bigint;
  denominator: bigint;
};

export type MithrilConsensusState = {
  timestamp: bigint;
  first_cert_hash_latest_epoch: string;
  latest_cert_hash_tx_snapshot: string;
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
