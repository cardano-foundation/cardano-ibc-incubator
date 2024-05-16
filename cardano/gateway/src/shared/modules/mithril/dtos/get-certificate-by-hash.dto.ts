import { Beacon, ProtocolMessage, SignedEntityType } from './common.dto';

export class CertificateDetailDTO {
  hash: string;
  previous_hash: string;
  epoch: number;
  beacon: Beacon;
  signed_entity_type: SignedEntityType;
  metadata: CertificateDetailMetadata;
  protocol_message: ProtocolMessage;
  signed_message: string;
  aggregate_verification_key: string;
  multi_signature: string;
  genesis_signature: string;
}

export class CertificateDetailMetadata {
  network: string;
  version: string;
  parameters: {
    k: number;
    m: number;
    phi_f: number;
  };
  initiated_at: string;
  sealed_at: string;
  signers: SignerDetail[];
}

export class SignerDetail {
  party_id: string;
  verification_key: string;
  verification_key_signature: string;
  operational_certificate: string;
  kes_period: number;
  stake: number;
}
