import { ValidatorSet as ValidatorSetMsg } from '@cardano-ibc/proto-types/build/tendermint/types/validator';
import { ValidatorSet, validatorSetFromProto } from './cometbft/validator-set';
import { SignedHeader, validateBasic as validateSignedHeaderBasic } from './cometbft/signed-header';
import { Height } from './height';
import { Header as HeaderMsg } from '@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { fromHex, toHex } from '../helpers/hex';
import { Rational } from './rational';
import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { TmHeader } from './cometbft/header';
import { ConsensusState } from './consensus-state';
import { ClientDatum } from './client-datum';
import { Timestamp } from '@cardano-ibc/proto-types/build/google/protobuf/timestamp';
import { blockIDFlagFromJSON } from '@cardano-ibc/proto-types/build/tendermint/types/types';
import { EPOCH_DIFF_BTW_GO_JS } from '../../constant/block';
import { safeAddClip } from '../helpers/number';

export type Header = {
  signedHeader: SignedHeader;
  validatorSet: ValidatorSet;
  trustedHeight: Height;
  trustedValidators: ValidatorSet;
};

function toTendermintBlockIdFlag(flag: bigint): number {
  // On-chain redeemers store enum tags as bigint; protobuf encoders expect numeric enum tags.
  return blockIDFlagFromJSON(Number(flag));
}

// Convert Header operator to a structured Header object to submit to cardano

export function initializeHeader(headerMsg: HeaderMsg): Header {
  const signedHeader = headerMsg.signed_header;
  if (!signedHeader) throw new GrpcInvalidArgumentException('missing signed header');

  const tmHeader = signedHeader.header;
  if (!tmHeader) throw new GrpcInvalidArgumentException('missing header');

  const commit = signedHeader.commit;
  if (!commit) throw new GrpcInvalidArgumentException('missing commit');

  const validatorSet = headerMsg.validator_set;
  if (!validatorSet) throw new GrpcInvalidArgumentException('missing validator set');
  const proposer = validatorSet.proposer;
  if (!proposer) throw new GrpcInvalidArgumentException('missing validator set proposer');

  const trustedValidators = headerMsg.trusted_validators;
  if (!trustedValidators) throw new GrpcInvalidArgumentException('missing trusted validator set');
  const trustedProposer = trustedValidators.proposer;
  if (!trustedProposer) throw new GrpcInvalidArgumentException('missing trusted validator set proposer');

  const toBytes = (value: Uint8Array | null | undefined): string => (value ? toHex(value) : '');
  const header: Header = {
    signedHeader: {
      header: {
        version: {
          block: BigInt(tmHeader.version.block),
          app: BigInt(tmHeader.version.app),
        },
        chainId: toBytes(Buffer.from(tmHeader.chain_id)),
        height: BigInt(tmHeader.height),
        time: BigInt(tmHeader.time.seconds) * 10n ** 9n + BigInt(tmHeader.time.nanos),
        lastBlockId: {
          hash: toBytes(tmHeader.last_block_id.hash),
          partSetHeader: {
            total: BigInt(tmHeader.last_block_id.part_set_header.total),
            hash: toBytes(tmHeader.last_block_id.part_set_header.hash),
          },
        },
        lastCommitHash: toBytes(tmHeader.last_commit_hash),
        dataHash: toBytes(tmHeader.data_hash),
        validatorsHash: toBytes(tmHeader.validators_hash),
        nextValidatorsHash: toBytes(tmHeader.next_validators_hash),
        consensusHash: toBytes(tmHeader.consensus_hash),
        appHash: toBytes(tmHeader.app_hash),
        lastResultsHash: toBytes(tmHeader.last_results_hash),
        evidenceHash: toBytes(tmHeader.evidence_hash),
        proposerAddress: toBytes(tmHeader.proposer_address),
      },
      commit: {
        height: BigInt(commit.height),
        round: BigInt(commit.round),
        blockId: {
          hash: toBytes(commit.block_id.hash),
          partSetHeader: {
            total: BigInt(commit.block_id.part_set_header.total),
            hash: toBytes(commit.block_id.part_set_header.hash),
          },
        },
        signatures: commit.signatures.map((signature) => {
          let timestamp = BigInt(signature.timestamp.seconds) * 10n ** 9n + BigInt(signature.timestamp.nanos);
          if (timestamp < 0 && 0n - timestamp === EPOCH_DIFF_BTW_GO_JS) timestamp = 0n;

          return {
            block_id_flag: BigInt(signature.block_id_flag),
            validator_address: toHex(signature.validator_address),
            timestamp: timestamp,
            signature: toHex(signature.signature),
          };
        }),
      },
    },
    validatorSet: {
      validators: validatorSet.validators.map((validator) => ({
        address: toBytes(validator.address),
        pubkey: toBytes(validator.pub_key.ed25519) || toBytes(validator.pub_key.secp256k1),
        votingPower: validator.voting_power,
        proposerPriority: validator.proposer_priority,
      })),
      proposer: {
        address: toBytes(proposer.address),
        pubkey: toBytes(proposer.pub_key.ed25519) || toBytes(proposer.pub_key.secp256k1),
        votingPower: proposer.voting_power,
        proposerPriority: proposer.proposer_priority,
      },
      totalVotingPower: getTotalVotingPowerFromTendermint(validatorSet),
    },
    trustedHeight: {
      revisionHeight: headerMsg.trusted_height.revision_height,
      revisionNumber: headerMsg.trusted_height.revision_number,
    },
    trustedValidators: {
      validators: trustedValidators.validators.map((validator) => ({
        address: toBytes(validator.address),
        pubkey: toBytes(validator.pub_key.ed25519) || toBytes(validator.pub_key.secp256k1),
        votingPower: validator.voting_power,
        proposerPriority: validator.proposer_priority,
      })),
      proposer: {
        address: toBytes(trustedProposer.address),
        pubkey: toBytes(trustedProposer.pub_key.ed25519) || toBytes(trustedProposer.pub_key.secp256k1),
        votingPower: trustedProposer.voting_power,
        proposerPriority: trustedProposer.proposer_priority,
      },
      totalVotingPower: getTotalVotingPowerFromTendermint(trustedValidators),
    },
  };
  return header;
}

function getTotalVotingPowerFromTendermint(vp: ValidatorSetMsg): bigint {
  const MAX_TOTAL_VOTING_POWER = Number.MAX_SAFE_INTEGER / 8;
  if (vp.total_voting_power || vp.total_voting_power === 0n) {
    let sum = 0;
    for (const val of vp.validators) {
      sum = safeAddClip(sum, Number(val.voting_power));
      if (sum > MAX_TOTAL_VOTING_POWER) {
        throw new GrpcInvalidArgumentException(
          `Total voting power exceeds maximum: ${MAX_TOTAL_VOTING_POWER}, calculated: ${sum}`,
        );
      }
    }

    return BigInt(sum);
  }
  return vp.total_voting_power;
}

export function convertHeaderToTendermint(header: Header): HeaderMsg {
  const headerTenderMint: HeaderMsg = {
    signed_header: {
      header: {
        // Replay events must preserve the canonical Tendermint header fields Hermes validates.
        version: {
          block: header.signedHeader.header.version.block,
          app: header.signedHeader.header.version.app,
        },
        chain_id: Buffer.from(fromHex(header.signedHeader.header.chainId)).toString(),
        height: header.signedHeader.header.height,
        time: {
          seconds: header.signedHeader.header.time / 10n ** 9n,
          nanos: Number(header.signedHeader.header.time % 10n ** 9n),
        },
        last_block_id: {
          hash: fromHex(header.signedHeader.header.lastBlockId.hash),
          part_set_header: {
            total: Number(header.signedHeader.header.lastBlockId.partSetHeader.total),
            hash: fromHex(header.signedHeader.header.lastBlockId.partSetHeader.hash),
          },
        },
        last_commit_hash: fromHex(header.signedHeader.header.lastCommitHash),
        data_hash: fromHex(header.signedHeader.header.dataHash),
        validators_hash: fromHex(header.signedHeader.header.validatorsHash),
        next_validators_hash: fromHex(header.signedHeader.header.nextValidatorsHash),
        consensus_hash: fromHex(header.signedHeader.header.consensusHash),
        app_hash: fromHex(header.signedHeader.header.appHash),
        last_results_hash: fromHex(header.signedHeader.header.lastResultsHash),
        evidence_hash: fromHex(header.signedHeader.header.evidenceHash),
        proposer_address: fromHex(header.signedHeader.header.proposerAddress),
      },
      commit: {
        height: header.signedHeader.commit.height,
        round: Number(header.signedHeader.commit.round),
        block_id: {
          hash: fromHex(header.signedHeader.commit.blockId.hash),
          part_set_header: {
            total: Number(header.signedHeader.commit.blockId.partSetHeader.total),
            hash: fromHex(header.signedHeader.commit.blockId.partSetHeader.hash),
          },
        },
        signatures: header.signedHeader.commit.signatures.map((commitSig) => ({
          block_id_flag: toTendermintBlockIdFlag(commitSig.block_id_flag),
          validator_address: commitSig?.validator_address ? fromHex(commitSig.validator_address) : new Uint8Array(),
          timestamp: {
            seconds: commitSig.timestamp / 10n ** 9n,
            nanos: Number(commitSig.timestamp % 10n ** 9n),
          } as Timestamp,
          signature: commitSig?.signature ? fromHex(commitSig.signature) : new Uint8Array(),
        })),
      },
    },
    validator_set: {
      validators: header.validatorSet.validators.map((validator) => ({
        address: fromHex(validator.address),
        pub_key: {
          ed25519: fromHex(validator.pubkey),
          secp256k1: undefined,
        },
        voting_power: validator.votingPower,
        proposer_priority: validator.proposerPriority,
      })),
      proposer: {
        address: fromHex(header.validatorSet.proposer.address),
        pub_key: {
          ed25519: fromHex(header.validatorSet.proposer.pubkey),
          secp256k1: undefined,
        },
        voting_power: header.validatorSet.proposer.votingPower,
        proposer_priority: header.validatorSet.proposer.proposerPriority,
      },
      total_voting_power: header.validatorSet.totalVotingPower,
    },
    trusted_height: {
      revision_number: header.trustedHeight.revisionNumber,
      revision_height: header.trustedHeight.revisionHeight,
    },
    trusted_validators: {
      validators: header.trustedValidators.validators.map((validator) => ({
        address: fromHex(validator.address),
        pub_key: {
          ed25519: fromHex(validator.pubkey),
          secp256k1: undefined,
        },
        voting_power: validator.votingPower,
        proposer_priority: validator.proposerPriority,
      })),
      proposer: {
        address: fromHex(header.trustedValidators.proposer.address),
        pub_key: {
          ed25519: fromHex(header.trustedValidators.proposer.pubkey),
          secp256k1: undefined,
        },
        voting_power: header.trustedValidators.proposer.votingPower,
        proposer_priority: header.trustedValidators.proposer.proposerPriority,
      },
      total_voting_power: header.trustedValidators.totalVotingPower,
    },
  };
  return headerTenderMint;
}

// verifyHeader returns an error if:
// - the client or header provided are not parseable to tendermint types
// - the header is invalid
// - header height is less than or equal to the trusted header height
// - header revision is not equal to trusted header revision
// - header valset commit verification fails
// - header timestamp is past the trusting period in relation to the consensus state
// - header timestamp is less than or equal to the consensus state timestamp
export function verifyHeader(msg: Header, clientDatum: ClientDatum): boolean {
  const currentTimestamp = msg.signedHeader.header.time;
  const clientState = clientDatum.state.clientState;
  // Retrieve trusted consensus states for each Header in misbehaviour
  const trustedHeight = msg.trustedHeight;
  const heightsArray = Array.from(clientDatum.state.consensusStates.entries());
  const trustedHeightValid = heightsArray.find(([heightK]) => trustedHeight.revisionHeight === heightK.revisionHeight);
  if (!trustedHeightValid)
    throw new GrpcInvalidArgumentException(
      `could not get trusted consensus state for Header at TrustedHeight: ${trustedHeight.revisionHeight}`,
    );

  const [_, consState] = trustedHeightValid;
  checkTrustedHeader(msg, consState);

  // UpdateClient only accepts updates with a header at the same revision
  // as the trusted consensus state
  // if (msg.signedHeader.header.height !== msg.trustedHeight.revisionHeight)
  //   throw new GrpcInvalidArgumentException(
  //     `header height revision ${msg.signedHeader.header.height} does not match trusted header revision ${msg.trustedHeight.revisionHeight}`,
  //   );

  const tmTrustedValidators = validatorSetFromProto(msg.trustedValidators);
  if (!tmTrustedValidators)
    throw new GrpcInvalidArgumentException('trusted validator set in not tendermint validator set type');

  const tmSignedHeader = msg.signedHeader;
  if (!tmSignedHeader) throw new GrpcInvalidArgumentException('signed header in not tendermint signed header type');

  const tmValidatorSet = validatorSetFromProto(msg.validatorSet);
  if (!tmValidatorSet) throw new GrpcInvalidArgumentException('validator set in not tendermint validator set type');

  // assert header height is newer than consensus state
  if (msg.signedHeader.header.height <= msg.trustedHeight.revisionHeight) {
    throw new GrpcInvalidArgumentException(
      `header height ≤ consensus state height (${msg.signedHeader.header.height} ≤ ${msg.trustedHeight.revisionHeight})`,
    );
  }

  // Construct a trusted header using the fields in consensus state
  // Only Height, Time, and NextValidatorsHash are necessary for verification
  // NOTE: updates must be within the same revision
  const trustedHeader: TmHeader = {
    chainId: clientState.chainId,
    height: msg.trustedHeight.revisionHeight,
    time: consState.timestamp,
    nextValidatorsHash: consState.next_validators_hash,
  } as unknown as TmHeader;
  const signedHeader: SignedHeader = {
    header: trustedHeader,
  } as unknown as SignedHeader;

  if (
    !verify(
      signedHeader,
      tmTrustedValidators,
      tmSignedHeader,
      tmValidatorSet,
      clientState.trustingPeriod,
      currentTimestamp,
      clientState.maxClockDrift,
      clientState.trustLevel,
    )
  )
    throw new GrpcInvalidArgumentException('failed to verify header');

  return true;
}

// checkTrustedHeader checks that consensus state matches trusted fields of Header
export function checkTrustedHeader(header: Header, _consState: ConsensusState): boolean {
  const tmTrustedValidators = validatorSetFromProto(header.trustedValidators);
  if (!tmTrustedValidators) {
    throw new GrpcInvalidArgumentException('trusted validator set in not tendermint validator set type');
  }

  // TODO
  // assert that trustedVals is NextValidators of last trusted header
  // to do this, we check that trustedVals.Hash() == consState.NextValidatorsHash
  // const tvalHash = tmTrustedValidators.Hash()
  // if !bytes.Equal(consState.NextValidatorsHash, tvalHash) {
  //   return errorsmod.Wrapf(
  //     ErrInvalidValidatorSet,
  //     "trusted validators %s, does not hash to latest trusted validators. Expected: %X, got: %X",
  //     header.TrustedValidators, consState.NextValidatorsHash, tvalHash,
  //   )
  // }

  // TODO
  // if (header.signedHeader.header.nextValidatorsHash !== consState.next_validators_hash) {
  //   throw new GrpcInvalidArgumentException(
  //     `trusted validators does not hash to latest trusted validators. Expected: ${consState.next_validators_hash}, got: ${header.signedHeader.header.nextValidatorsHash}`,
  //   );
  // }
  return true;
}

export function verify(
  trustedHeader: SignedHeader,
  trustedVals: ValidatorSet,
  untrustedHeader: SignedHeader,
  untrustedVals: ValidatorSet,
  trustingPeriod: bigint,
  now: bigint,
  maxClockDrift: bigint,
  trustedLevel: Rational,
): boolean {
  if (untrustedHeader.header.height !== trustedHeader.header.height + 1n) {
    return verifyNonAdjacent(
      trustedHeader,
      trustedVals,
      untrustedHeader,
      untrustedVals,
      trustingPeriod,
      now,
      maxClockDrift,
      trustedLevel,
    );
  }
  return verifyAdjacent(
    trustedHeader,
    trustedVals,
    untrustedHeader,
    untrustedVals,
    trustingPeriod,
    now,
    maxClockDrift,
    trustedLevel,
  );
}

// VerifyNonAdjacent verifies non-adjacent untrustedHeader against
// trustedHeader. It ensures that:
//
//		a) trustedHeader can still be trusted (if not, ErrOldHeaderExpired is returned)
//		b) untrustedHeader is valid (if not, ErrInvalidHeader is returned)
//		c) trustLevel ([1/3, 1]) of trustedHeaderVals (or trustedHeaderNextVals)
//	 signed correctly (if not, ErrNewValSetCantBeTrusted is returned)
//		d) more than 2/3 of untrustedVals have signed h2
//	   (otherwise, ErrInvalidHeader is returned)
//	 e) headers are non-adjacent.
//
// maxClockDrift defines how much untrustedHeader.Time can drift into the
// future.
function verifyNonAdjacent(
  trustedHeader: SignedHeader,
  trustedVals: ValidatorSet,
  untrustedHeader: SignedHeader,
  untrustedVals: ValidatorSet,
  trustingPeriod: bigint,
  now: bigint,
  maxClockDrift: bigint,
  _trustedLevel: Rational,
): boolean {
  if (untrustedHeader.header.height === trustedHeader.header.height + 1n) {
    throw new GrpcInvalidArgumentException('headers must be non adjacent in height');
  }

  if (headerExpired(trustedHeader, trustingPeriod, now)) {
    throw new GrpcInvalidArgumentException(
      `old header has expired at ${trustedHeader.header.time + trustingPeriod} (now: ${now})`,
    );
  }

  verifyNewHeaderAndVals(untrustedHeader, untrustedVals, trustedHeader, now, maxClockDrift);

  // Ensure that +`trustLevel` (default 1/3) or more of last trusted validators signed correctly.
  // err := trustedVals.VerifyCommitLightTrusting(trustedHeader.ChainID, untrustedHeader.Commit, trustLevel)
  // if err != nil {
  // 	switch e := err.(type) {
  // 	case types.ErrNotEnoughVotingPowerSigned:
  // 		return ErrNewValSetCantBeTrusted{e}
  // 	default:
  // 		return e
  // 	}
  // }

  // // Ensure that +2/3 of new validators signed correctly.
  // //
  // // NOTE: this should always be the last check because untrustedVals can be
  // // intentionally made very large to DOS the light client. not the case for
  // // VerifyAdjacent, where validator set is known in advance.
  // if err := untrustedVals.VerifyCommitLight(trustedHeader.ChainID, untrustedHeader.Commit.BlockID,
  // 	untrustedHeader.Height, untrustedHeader.Commit); err != nil {
  // 	return ErrInvalidHeader{err}
  // }

  return true;
}

// HeaderExpired return true if the given header expired.
function headerExpired(h: SignedHeader, trustingPeriod: bigint, now: bigint): boolean {
  const expirationTime = h.header.time + trustingPeriod;
  return now > expirationTime;
}

function verifyNewHeaderAndVals(
  untrustedHeader: SignedHeader,
  untrustedVals: ValidatorSet,
  trustedHeader: SignedHeader,
  now: bigint,
  maxClockDrift: bigint, // Assuming maxClockDrift is in milliseconds
): Error | null {
  validateSignedHeaderBasic(untrustedHeader, trustedHeader.header.chainId);
  if (untrustedHeader.header.height <= trustedHeader.header.height) {
    throw new GrpcInvalidArgumentException(
      `expected new header height ${untrustedHeader.header.height} to be greater than old header height ${trustedHeader.header.height}`,
    );
  }
  if (untrustedHeader.header.time <= trustedHeader.header.time) {
    throw new GrpcInvalidArgumentException(
      `expected new header time ${untrustedHeader.header.time} to be after old header time ${trustedHeader.header.time}`,
    );
  }

  const maxAllowedTime = now + maxClockDrift;
  if (untrustedHeader.header.time > maxAllowedTime) {
    throw new GrpcInvalidArgumentException(
      `new header has a time from the future ${untrustedHeader.header.time} (now: ${now}; max clock drift: ${maxClockDrift}ms)`,
    );
  }

  // TODO
  // if (!compareArrays(untrustedHeader.header.validatorsHash, untrustedVals.Hash())) { // Assuming compareArrays exists
  //   throw new GrpcInvalidArgumentException(`expected new header validators (${untrustedHeader.ValidatorsHash}) to match those supplied (${untrustedVals.Hash()}) at height ${untrustedHeader.Height}`);
  // }

  return null; // No errors found
}

function verifyAdjacent(
  trustedHeader: SignedHeader,
  trustedVals: ValidatorSet,
  untrustedHeader: SignedHeader,
  untrustedVals: ValidatorSet,
  trustingPeriod: bigint,
  now: bigint,
  maxClockDrift: bigint,
  _trustedLevel: Rational,
): boolean {
  if (untrustedHeader.header.height !== trustedHeader.header.height + 1n) {
    throw new GrpcInvalidArgumentException('headers must be adjacent in height');
  }

  verifyNewHeaderAndVals(untrustedHeader, untrustedVals, trustedHeader, now, maxClockDrift);

  if (untrustedHeader.header.validatorsHash !== trustedHeader.header.nextValidatorsHash) {
    throw new GrpcInvalidArgumentException(
      `expected old header next validators (${untrustedHeader.header.validatorsHash}) to match those from new header (${trustedHeader.header.nextValidatorsHash})`,
    );
  }

  // TODO
  // Ensure that +2/3 of new validators signed correctly.
  // if err := untrustedVals.VerifyCommitLight(trustedHeader.ChainID, untrustedHeader.Commit.BlockID,
  // 	untrustedHeader.Height, untrustedHeader.Commit); err != nil {
  // 	return ErrInvalidHeader{err}
  // }

  return false;
}
export function decodeHeader(value: Uint8Array): HeaderMsg {
  try {
    return HeaderMsg.decode(value);
  } catch (error) {
    throw new GrpcInvalidArgumentException(`Error decoding header: ${error}`);
  }
}
