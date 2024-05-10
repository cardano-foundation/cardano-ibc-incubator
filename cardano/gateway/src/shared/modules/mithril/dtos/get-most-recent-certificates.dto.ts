import { Beacon, CertificateMetadata, ProtocolMessage, SignedEntityType } from './common.dto';

export class CertificateDTO {
  hash: string;
  previous_hash: string;
  epoch: number;
  signed_entity_type: SignedEntityType;
  beacon: Beacon;
  metadata: CertificateMetadata;
  protocol_message: ProtocolMessage;
  signed_message: string;
  aggregate_verification_key: string;
}
