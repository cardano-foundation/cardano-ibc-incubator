export class Beacon {
  network: string;
  epoch: number;
  immutable_file_number: number;
}

export class CertificateMetadata {
  network: string;
  version: string;
  parameters: {
    k: number;
    m: number;
    phi_f: number;
  };
  initiated_at: string;
  sealed_at: string;
  total_signers: number;
}

export class ProtocolMessage {
  message_parts: {
    snapshot_digest: string;
    next_aggregate_verification_key: string;
    cardano_transactions_merkle_root?: string;
    latest_immutable_file_number?: number;
  };
}

export class SignedEntityType {
  CardanoImmutableFilesFull?: {
    network: string;
    epoch: number;
    immutable_file_number: number;
  };
  CardanoTransactions?: {
    network: string;
    epoch: number;
    immutable_file_number: number;
  };
}
