import crypto from 'crypto';

import type { AuthToken } from './auth-token';
import type { CommitSig, BlockID } from './cometbft/commit';
import type { TmHeader } from './cometbft/header';
import type { Validator } from './cometbft/validator';
import type { ConsensusState } from './consensus-state';
import type { Height } from './height';
import type { Rational } from './rational';

type LucidModule = typeof import('@lucid-evolution/lucid');
type LucidData = LucidModule['Data'];

export const TENDERMINT_UPDATE_SESSION_ID_DOMAIN = 'cardano-ibc/tendermint-update-session/v1';

export type OutputReference = {
  transactionId: string;
  outputIndex: bigint;
};

export type CommitCore = {
  height: bigint;
  round: bigint;
  blockId: BlockID;
};

export type UpdatePlan = {
  clientToken: AuthToken;
  trustedHeight: Height;
  trustedConsensusState: ConsensusState;
  trustLevel: Rational;
  trustingPeriod: bigint;
  maxClockDrift: bigint;
  header: TmHeader;
  commit: CommitCore;
  targetValidatorCount: bigint;
  trustedValidatorCount: bigint;
};

export type MerklePeak = {
  size: bigint;
  root: string;
};

export type MerkleAccumulator = {
  count: bigint;
  peaks: MerklePeak[];
};

export type ValidatorOrderKey = {
  votingPower: bigint;
  address: string;
};

export type TrustedMembership = {
  index: bigint;
  trustedValidator: Validator;
  auditPath: string[];
};

export type TargetEntry = {
  targetValidator: Validator;
  commitSig: CommitSig;
  trustedMembership: TrustedMembership | null;
};

export type SessionPhase =
  | {
      AdjacentTarget: {
        targetAccumulator: MerkleAccumulator;
        targetTotalPower: bigint;
        targetSignedPower: bigint;
        lastTarget: ValidatorOrderKey | null;
      };
    }
  | {
      NonAdjacentTrusted: {
        trustedAccumulator: MerkleAccumulator;
        trustedTotalPower: bigint;
        lastTrusted: ValidatorOrderKey | null;
      };
    }
  | {
      NonAdjacentTarget: {
        trustedRoot: string;
        trustedTotalPower: bigint;
        targetAccumulator: MerkleAccumulator;
        targetTotalPower: bigint;
        targetSignedPower: bigint;
        trustedSignedPower: bigint;
        usedTrustedIndices: bigint;
        lastTarget: ValidatorOrderKey | null;
      };
    }
  | {
      Complete: {
        targetRoot: string;
        targetTotalPower: bigint;
        targetSignedPower: bigint;
        trustedRoot: string | null;
        trustedTotalPower: bigint;
        trustedSignedPower: bigint;
      };
    };

export type SessionDatum = {
  sessionToken: AuthToken;
  owner: string;
  plan: UpdatePlan;
  phase: SessionPhase;
};

export type MintSessionRedeemer =
  | {
      MintSession: {
        seed: OutputReference;
        owner: string;
        plan: UpdatePlan;
      };
    }
  | {
      BurnSession: {
        tokenName: string;
      };
    };

export type SpendSessionRedeemer =
  | {
      VerifyTrusted: {
        validators: Validator[];
      };
    }
  | {
      VerifyTarget: {
        entries: TargetEntry[];
      };
    }
  | 'Finalize'
  | 'Cancel';

export type SpendMultitxClientRedeemer =
  | {
      FinalizeUpdate: {
        sessionToken: AuthToken;
      };
    }
  | 'DirectUpdateDisabled';

/**
 * Build all schemas in one place so constructor and record-field order cannot
 * drift between the individual datum/redeemer codecs.
 */
export function createTendermintUpdateSessionSchemas(Data: LucidData) {
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const MerkleRootSchema = Data.Object({
    hash: Data.Bytes(),
  });
  const ConsensusStateSchema = Data.Object({
    timestamp: Data.Integer(),
    next_validators_hash: Data.Bytes(),
    root: MerkleRootSchema,
  });
  const RationalSchema = Data.Object({
    numerator: Data.Integer(),
    denominator: Data.Integer(),
  });
  const PartSetHeaderSchema = Data.Object({
    total: Data.Integer(),
    hash: Data.Bytes(),
  });
  const BlockIdSchema = Data.Object({
    hash: Data.Bytes(),
    partSetHeader: PartSetHeaderSchema,
  });
  const ConsensusVersionSchema = Data.Object({
    block: Data.Integer(),
    app: Data.Integer(),
  });
  const TmHeaderSchema = Data.Object({
    version: ConsensusVersionSchema,
    chainId: Data.Bytes(),
    height: Data.Integer(),
    time: Data.Integer(),
    lastBlockId: BlockIdSchema,
    lastCommitHash: Data.Bytes(),
    dataHash: Data.Bytes(),
    validatorsHash: Data.Bytes(),
    nextValidatorsHash: Data.Bytes(),
    consensusHash: Data.Bytes(),
    appHash: Data.Bytes(),
    lastResultsHash: Data.Bytes(),
    evidenceHash: Data.Bytes(),
    proposerAddress: Data.Bytes(),
  });
  const CommitCoreSchema = Data.Object({
    height: Data.Integer(),
    round: Data.Integer(),
    blockId: BlockIdSchema,
  });
  const UpdatePlanSchema = Data.Object({
    clientToken: AuthTokenSchema,
    trustedHeight: HeightSchema,
    trustedConsensusState: ConsensusStateSchema,
    trustLevel: RationalSchema,
    trustingPeriod: Data.Integer(),
    maxClockDrift: Data.Integer(),
    header: TmHeaderSchema,
    commit: CommitCoreSchema,
    targetValidatorCount: Data.Integer(),
    trustedValidatorCount: Data.Integer(),
  });
  const MerklePeakSchema = Data.Object({
    size: Data.Integer(),
    root: Data.Bytes(),
  });
  const MerkleAccumulatorSchema = Data.Object({
    count: Data.Integer(),
    peaks: Data.Array(MerklePeakSchema),
  });
  const ValidatorSchema = Data.Object({
    address: Data.Bytes(),
    pubkey: Data.Bytes(),
    votingPower: Data.Integer(),
    proposerPriority: Data.Integer(),
  });
  const CommitSigSchema = Data.Object({
    block_id_flag: Data.Integer(),
    validator_address: Data.Bytes(),
    timestamp: Data.Integer(),
    signature: Data.Bytes(),
  });
  const ValidatorOrderKeySchema = Data.Object({
    votingPower: Data.Integer(),
    address: Data.Bytes(),
  });
  const TrustedMembershipSchema = Data.Object({
    index: Data.Integer(),
    trustedValidator: ValidatorSchema,
    auditPath: Data.Array(Data.Bytes()),
  });
  const TargetEntrySchema = Data.Object({
    targetValidator: ValidatorSchema,
    commitSig: CommitSigSchema,
    trustedMembership: Data.Nullable(TrustedMembershipSchema),
  });
  const SessionPhaseSchema = Data.Enum([
    Data.Object({
      AdjacentTarget: Data.Object({
        targetAccumulator: MerkleAccumulatorSchema,
        targetTotalPower: Data.Integer(),
        targetSignedPower: Data.Integer(),
        lastTarget: Data.Nullable(ValidatorOrderKeySchema),
      }),
    }),
    Data.Object({
      NonAdjacentTrusted: Data.Object({
        trustedAccumulator: MerkleAccumulatorSchema,
        trustedTotalPower: Data.Integer(),
        lastTrusted: Data.Nullable(ValidatorOrderKeySchema),
      }),
    }),
    Data.Object({
      NonAdjacentTarget: Data.Object({
        trustedRoot: Data.Bytes(),
        trustedTotalPower: Data.Integer(),
        targetAccumulator: MerkleAccumulatorSchema,
        targetTotalPower: Data.Integer(),
        targetSignedPower: Data.Integer(),
        trustedSignedPower: Data.Integer(),
        usedTrustedIndices: Data.Integer(),
        lastTarget: Data.Nullable(ValidatorOrderKeySchema),
      }),
    }),
    Data.Object({
      Complete: Data.Object({
        targetRoot: Data.Bytes(),
        targetTotalPower: Data.Integer(),
        targetSignedPower: Data.Integer(),
        trustedRoot: Data.Nullable(Data.Bytes()),
        trustedTotalPower: Data.Integer(),
        trustedSignedPower: Data.Integer(),
      }),
    }),
  ]);
  const SessionDatumSchema = Data.Object({
    sessionToken: AuthTokenSchema,
    owner: Data.Bytes(),
    plan: UpdatePlanSchema,
    phase: SessionPhaseSchema,
  });
  const OutputReferenceSchema = Data.Object({
    transactionId: Data.Bytes(),
    outputIndex: Data.Integer(),
  });
  const MintSessionRedeemerSchema = Data.Enum([
    Data.Object({
      MintSession: Data.Object({
        seed: OutputReferenceSchema,
        owner: Data.Bytes(),
        plan: UpdatePlanSchema,
      }),
    }),
    Data.Object({
      BurnSession: Data.Object({
        tokenName: Data.Bytes(),
      }),
    }),
  ]);
  const SpendSessionRedeemerSchema = Data.Enum([
    Data.Object({
      VerifyTrusted: Data.Object({
        validators: Data.Array(ValidatorSchema),
      }),
    }),
    Data.Object({
      VerifyTarget: Data.Object({
        entries: Data.Array(TargetEntrySchema),
      }),
    }),
    Data.Literal('Finalize'),
    Data.Literal('Cancel'),
  ]);
  const SpendMultitxClientRedeemerSchema = Data.Enum([
    Data.Object({
      FinalizeUpdate: Data.Object({
        sessionToken: AuthTokenSchema,
      }),
    }),
    Data.Literal('DirectUpdateDisabled'),
  ]);

  return {
    OutputReferenceSchema,
    UpdatePlanSchema,
    SessionDatumSchema,
    MintSessionRedeemerSchema,
    SpendSessionRedeemerSchema,
    SpendMultitxClientRedeemerSchema,
  };
}

export function encodeUpdatePlan(value: UpdatePlan, Lucid: LucidModule): string {
  const { UpdatePlanSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  // Aiken's session ID hashes cbor.serialise(plan). Lucid's default Cardano-node
  // format, rather than canonical CBOR, matches that Aiken serialization.
  return Lucid.Data.to(value, UpdatePlanSchema as unknown as UpdatePlan);
}

export function decodeUpdatePlan(value: string, Lucid: LucidModule): UpdatePlan {
  const { UpdatePlanSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  return Lucid.Data.from(value, UpdatePlanSchema as unknown as UpdatePlan);
}

/** Exact Aiken `session.plan_hash` commitment. */
export function tendermintUpdatePlanHash(plan: UpdatePlan, Lucid: LucidModule): string {
  return sha3_256(
    Buffer.from(TENDERMINT_UPDATE_SESSION_ID_DOMAIN, 'utf8'),
    Buffer.from(encodeUpdatePlan(plan, Lucid), 'hex'),
  );
}

/** Exact Aiken `session.session_token_name` commitment. */
export function tendermintUpdateSessionTokenName(seed: OutputReference, plan: UpdatePlan, Lucid: LucidModule): string {
  const { OutputReferenceSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  // Like UpdatePlan, OutputReference must use the non-canonical encoding that
  // Aiken's cbor.serialise produces for the token-name preimage.
  const encodedSeed = Lucid.Data.to(seed, OutputReferenceSchema as unknown as OutputReference);
  return sha3_256(
    Buffer.from(TENDERMINT_UPDATE_SESSION_ID_DOMAIN, 'utf8'),
    Buffer.from(encodedSeed, 'hex'),
    Buffer.from(tendermintUpdatePlanHash(plan, Lucid), 'hex'),
  );
}

/** Compare plans by the exact immutable commitment enforced on chain. */
export function sameTendermintUpdatePlan(left: UpdatePlan, right: UpdatePlan, Lucid: LucidModule): boolean {
  return tendermintUpdatePlanHash(left, Lucid) === tendermintUpdatePlanHash(right, Lucid);
}

export function encodeSessionDatum(value: SessionDatum, Lucid: LucidModule): string {
  const { SessionDatumSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  // Datums/redeemers are compared as Plutus Data, so canonical CBOR is safe
  // and smaller. Only the plan-hash preimage above must stay non-canonical.
  return Lucid.Data.to(value, SessionDatumSchema as unknown as SessionDatum, { canonical: true });
}

export function decodeSessionDatum(value: string, Lucid: LucidModule): SessionDatum {
  const { SessionDatumSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  return Lucid.Data.from(value, SessionDatumSchema as unknown as SessionDatum);
}

export function encodeMintSessionRedeemer(value: MintSessionRedeemer, Lucid: LucidModule): string {
  const { MintSessionRedeemerSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  return Lucid.Data.to(value, MintSessionRedeemerSchema as unknown as MintSessionRedeemer, { canonical: true });
}

export function decodeMintSessionRedeemer(value: string, Lucid: LucidModule): MintSessionRedeemer {
  const { MintSessionRedeemerSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  return Lucid.Data.from(value, MintSessionRedeemerSchema as unknown as MintSessionRedeemer);
}

export function encodeSpendSessionRedeemer(value: SpendSessionRedeemer, Lucid: LucidModule): string {
  const { SpendSessionRedeemerSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  return Lucid.Data.to(value, SpendSessionRedeemerSchema as unknown as SpendSessionRedeemer, { canonical: true });
}

export function decodeSpendSessionRedeemer(value: string, Lucid: LucidModule): SpendSessionRedeemer {
  const { SpendSessionRedeemerSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  return Lucid.Data.from(value, SpendSessionRedeemerSchema as unknown as SpendSessionRedeemer);
}

export function encodeSpendMultitxClientRedeemer(value: SpendMultitxClientRedeemer, Lucid: LucidModule): string {
  const { SpendMultitxClientRedeemerSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  return Lucid.Data.to(value, SpendMultitxClientRedeemerSchema as unknown as SpendMultitxClientRedeemer, {
    canonical: true,
  });
}

export function decodeSpendMultitxClientRedeemer(value: string, Lucid: LucidModule): SpendMultitxClientRedeemer {
  const { SpendMultitxClientRedeemerSchema } = createTendermintUpdateSessionSchemas(Lucid.Data);
  return Lucid.Data.from(value, SpendMultitxClientRedeemerSchema as unknown as SpendMultitxClientRedeemer);
}

function sha3_256(...values: Buffer[]): string {
  const hash = crypto.createHash('sha3-256');
  values.forEach((value) => hash.update(value));
  return hash.digest('hex');
}
