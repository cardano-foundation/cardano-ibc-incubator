import { UTxO } from '@lucid-evolution/lucid';
import { ClientDatum } from '../../../shared/types/client-datum';
import { Header } from '../../../shared/types/header';
import { Height } from '../../../shared/types/height';
import { Any } from '@cardano-ibc/proto-types/build/google/protobuf/any';

export type UpdateClientOperatorDto = {
  clientId: string;
  header: Header;
  constructedAddress: string;
  clientDatum: ClientDatum;
  clientTokenUnit: string;
  currentClientUtxo: UTxO;
  txValidFrom: bigint;
  proof?: string;
  proofTime?: bigint;
  proofMisbehaviour?: boolean;
};

type UpdateOnMisbehaviourOperatorBase = {
  clientId: string;
  clientMessage: Any;
  constructedAddress: string;
  clientDatum: ClientDatum;
  clientTokenUnit: string;
  currentClientUtxo: UTxO;
};

export type UpdateOnMisbehaviourOperatorDto = UpdateOnMisbehaviourOperatorBase &
  (
    | { proof?: undefined }
    | {
        proof: string;
        proofTime: bigint;
        trustedHeight1: Height;
        trustedHeight2: Height;
      }
  );
