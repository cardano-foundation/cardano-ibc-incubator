import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import {
  Misbehaviour as MisbehaviourMsg,
  Header as HeaderMsg,
} from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { ClientDatum } from '../client-datum';

import { Header, checkTrustedHeader, decodeHeader, initializeHeader } from '../header';
import { ClientState } from '../client-state-types';
import { ConsensusState } from '../consensus-state';
import { validatorSetFromProto } from '../cometbft/validator-set';
import { Any } from '@plus/proto-types/build/google/protobuf/any';
import { deepEquals } from '@shared/helpers/deep-equal';
import { getConsensusStateFromTmHeader } from '../cometbft/header';
import { Height } from '../height';

export type Misbehaviour = {
  client_id: string;
  header1: Header;
  header2: Header;
};

export function initializeMisbehaviour(misbehaviourMsg: MisbehaviourMsg): Misbehaviour {
  const misbehaviour: Misbehaviour = {
    client_id: misbehaviourMsg.client_id,
    header1: initializeHeader(misbehaviourMsg.header1),
    header2: initializeHeader(misbehaviourMsg.header2),
  };

  return misbehaviour;
}

// verifyMisbehaviour determines whether or not two conflicting
// headers at the same height would have convinced the light client.
//
// NOTE: consensusState1 is the trusted consensus state that corresponds to the TrustedHeight
// of misbehaviour.Header1
// Similarly, consensusState2 is the trusted consensus state that corresponds
// to misbehaviour.Header2
// Misbehaviour sets frozen height to {0, 1} since it is only used as a boolean value (zero or non-zero).
export function verifyMisbehaviour(misbehaviour: Misbehaviour, clientDatum: ClientDatum): boolean {
  // Regardless of the type of misbehaviour, ensure that both headers are valid and would have been accepted by light-client
  const consensusHeightsArray = Array.from(clientDatum.state.consensusStates.entries());
  // Retrieve trusted consensus states for each Header in misbehaviour
  const trustedHeightValid1 = consensusHeightsArray.find(
    ([heightK]) => misbehaviour.header1.trustedHeight.revisionHeight === heightK.revisionHeight,
  );
  if (!trustedHeightValid1)
    throw new GrpcInvalidArgumentException(
      `could not get trusted consensus state from clientStore for Header1 at TrustedHeight: ${misbehaviour.header1.trustedHeight.revisionHeight}`,
    );

  const trustedHeightValid2 = consensusHeightsArray.find(
    ([heightK]) => misbehaviour.header2.trustedHeight.revisionHeight === heightK.revisionHeight,
  );
  if (!trustedHeightValid2)
    throw new GrpcInvalidArgumentException(
      `could not get trusted consensus state from clientStore for Header2 at TrustedHeight: ${misbehaviour.header2.trustedHeight.revisionHeight}`,
    );

  const [_, tmConsensusState1] = trustedHeightValid1;
  const [__, tmConsensusState2] = trustedHeightValid2;

  // Check the validity of the two conflicting headers against their respective
  // trusted consensus states
  // NOTE: header height and commitment root assertions are checked in
  // misbehaviour.ValidateBasic by the client keeper and msg.ValidateBasic
  // by the base application.
  const cs = clientDatum.state.clientState;
  checkMisbehaviourHeader(cs, tmConsensusState1, misbehaviour.header1, misbehaviour.header1.signedHeader.header.time);
  checkMisbehaviourHeader(cs, tmConsensusState2, misbehaviour.header2, misbehaviour.header2.signedHeader.header.time);

  return true;
}

function checkMisbehaviourHeader(
  clientState: ClientState,
  consState: ConsensusState,
  h: Header,
  currentTimestamp: bigint,
): boolean {
  const tmTrustedValset = validatorSetFromProto(h.trustedValidators);
  if (!tmTrustedValset)
    throw new GrpcInvalidArgumentException('trusted validator set is not tendermint validator set type');

  const tmCommit = h.signedHeader.commit;
  if (!tmCommit) throw new GrpcInvalidArgumentException('commit is not tendermint commit type');

  // check the trusted fields for the header against ConsensusState
  checkTrustedHeader(h, consState);

  // assert that the age of the trusted consensus state is not older than the trusting period
  if (currentTimestamp - consState.timestamp >= clientState.trustingPeriod)
    throw new GrpcInvalidArgumentException(
      `current timestamp minus the latest consensus state timestamp is greater than or equal to the trusting period (${currentTimestamp - consState.timestamp} >= ${clientState.trustingPeriod})`,
    );

  const chainID = clientState.chainId;
  // - ValidatorSet must have TrustLevel similarity with trusted FromValidatorSet
  // - ValidatorSets on both headers are valid given the last trusted ValidatorSet
  // if err := tmTrustedValset.VerifyCommitLightTrusting(
  //   chainID, tmCommit, clientState.TrustLevel.ToTendermint(),
  // ); err != nil {
  //   return errorsmod.Wrapf(clienttypes.ErrInvalidMisbehaviour, "validator set in header has too much change from trusted validator set: %v", err)
  // }

  return true;
}

export function checkForMisbehaviour(clientMessage: Any, clientDatum: ClientDatum): boolean {
  switch (clientMessage.type_url) {
    case '/ibc.lightclients.tendermint.v1.Header': {
      const headerMsg = decodeHeader(clientMessage.value);
      const header = initializeHeader(headerMsg);
      const consState = getConsensusStateFromTmHeader(header.signedHeader.header);

      // Check if the Client store already has a consensus state for the header's height
      // If the consensus state exists, and it matches the header then we return early
      // since header has already been submitted in a previous UpdateClient.
      const consensusHeightsArray = Array.from(clientDatum.state.consensusStates.entries());
      const existedConsensus = consensusHeightsArray.find(
        ([heightK]) => header.signedHeader.header.height === heightK.revisionHeight,
      );

      if (existedConsensus) {
        const [_, existingConsState] = existedConsensus;
        // This header has already been submitted and the necessary state is already stored
        // in client store, thus we can return early without further validation.

        if (deepEquals(existingConsState, consState)) return false;

        // A consensus state already exists for this height, but it does not match the provided header.
        // The assumption is that Header has already been validated. Thus we can return true as misbehaviour is present
        return true;
      }

      // Check that consensus state timestamps are monotonic
      const prevCons = getPreviousConsensusState(consensusHeightsArray, header.signedHeader.header.height);
      const nextCons = getNextConsensusState(consensusHeightsArray, header.signedHeader.header.height);
      // if previous consensus state exists, check consensus state time is greater than previous consensus state time
      // if previous consensus state is not before current consensus state return true
      if (prevCons && prevCons.timestamp > consState.timestamp) return true;
      // if next consensus state exists, check consensus state time is less than next consensus state time
      // if next consensus state is not after current consensus state return true
      if (nextCons && nextCons.timestamp < consState.timestamp) return true;

      break;
    }
    case '/ibc.lightclients.tendermint.v1.Misbehaviour': {
      const misbehaviourMsg = decodeMisBehaviour(clientMessage.value);
      const msg = initializeMisbehaviour(misbehaviourMsg);

      // if heights are equal check that this is valid misbehaviour of a fork
      // otherwise if heights are unequal check that this is valid misbehavior of BFT time violation
      if (msg.header1.signedHeader.header.height === msg.header2.signedHeader.header.height) {
        const blockID1 = msg.header1.signedHeader.commit.blockId;
        if (!blockID1) return false;

        const blockID2 = msg.header2.signedHeader.commit.blockId;
        if (!blockID2) return false;

        // Ensure that Commit Hashes are different
        if (blockID1.hash !== blockID2.hash) return true;
      } else if (msg.header1.signedHeader.header.time <= msg.header2.signedHeader.header.time) {
        // Header1 is at greater height than Header2, therefore Header1 time must be less than or equal to
        // Header2 time in order to be valid misbehaviour (violation of monotonic time).
        return true;
      }
      break;
    }
  }
  return false;
}

function getPreviousConsensusState(consensusStatesList: [Height, ConsensusState][], height: bigint): ConsensusState {
  const consensusStateAtGivenHeight = consensusStatesList.find(([heightK]) => heightK.revisionHeight === height);

  if (consensusStateAtGivenHeight) {
    const indexOfConsensusState = consensusStatesList.findIndex(([key]) => key.revisionHeight === height);

    if (indexOfConsensusState > 0) {
      const [_, prevState] = consensusStatesList[indexOfConsensusState - 1] || [];
      return prevState || null;
    }
    return null;
  }

  return null;
}

function getNextConsensusState(consensusStatesList: [Height, ConsensusState][], height: bigint): ConsensusState {
  const consensusStateAtGivenHeight = consensusStatesList.find(([heightK]) => heightK.revisionHeight === height);

  if (consensusStateAtGivenHeight) {
    const indexOfConsensusState = consensusStatesList.findIndex(([key]) => key.revisionHeight === height);

    if (indexOfConsensusState < consensusStatesList.length - 1) {
      const [_, nextState] = consensusStatesList[indexOfConsensusState + 1] || [];
      return nextState || null;
    }
  }
  return null;
}
export function decodeMisBehaviour(value: Uint8Array): MisbehaviourMsg {
  try {
    return MisbehaviourMsg.decode(value);
  } catch (error) {
    throw new GrpcInvalidArgumentException(`Error decoding header: ${error}`);
  }
}
