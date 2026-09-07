import { UTxO } from '@lucid-evolution/lucid';
import { ClientDatum } from '../../../shared/types/client-datum';
import { Header } from '../../../shared/types/header';
import { Any } from '@cardano-ibc/proto-types/build/google/protobuf/any';
import { HostStateDatum } from '../../../shared/types/host-state-datum';

export type UpdateClientOperatorDto = {
  clientId: string;
  header: Header;
  constructedAddress: string;
  clientDatum: ClientDatum;
  clientTokenUnit: string;
  currentClientUtxo: UTxO;
  txValidFrom: bigint;
};

export type UpdateOnMisbehaviourOperatorDto = {
  clientId: string;
  clientMessage: Any;
  constructedAddress: string;
  clientDatum: ClientDatum;
  clientTokenUnit: string;
  currentClientUtxo: UTxO;
};

export type RecoverClientOperatorDto = {
  subjectClientId: string;
  substituteClientId: string;
  constructedAddress: string;
  subjectClientDatum: ClientDatum;
  substituteClientDatum: ClientDatum;
  subjectClientTokenUnit: string;
  subjectClientUtxo: UTxO;
  substituteClientUtxo: UTxO;
  hostStateUtxo: UTxO;
  hostStateDatum: HostStateDatum;
  signerKeyHash: string;
  txValidTo: bigint;
};
