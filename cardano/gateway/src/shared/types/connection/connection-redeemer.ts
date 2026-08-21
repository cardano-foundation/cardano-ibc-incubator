import { Height } from '../height';
import { MerkleProof } from '../isc-23/merkle';
import {
  createHeightSchema,
  createIcs23MerkleProofSchema,
} from '../schema-fragments';
import { AuthToken } from '../auth-token';

type LucidData = typeof import('@lucid-evolution/lucid').Data;

export type MintConnectionRedeemer =
  | 'ConnOpenInit'
  | {
      ConnOpenTry: {
        client_state: string;
        proof_init: MerkleProof;
        proof_client: MerkleProof;
        proof_height: Height;
      };
    }
  | { BurnConnection: { token: AuthToken; reclaim_to: string } };

export type SpendConnectionRedeemer =
  | 'ConnOpenAck'
  | {
      ConnOpenConfirm: {
        proof_ack: MerkleProof;
        proof_height: Height;
      };
    }
  | 'IncrementChannelCount'
  | 'DecrementChannelCount'
  | { BeginConnectionRetirement: { not_before: bigint } }
  | { ReclaimConnection: { reclaim_to: string } };

function buildMintConnectionRedeemerSchema(Data: LucidData) {
  const HeightSchema = createHeightSchema(Data);
  const { MerkleProofSchema } = createIcs23MerkleProofSchema(Data);
  const AuthTokenSchema = Data.Object({ policyId: Data.Bytes(), name: Data.Bytes() });

  return Data.Enum([
    Data.Literal('ConnOpenInit'),
    Data.Object({
      ConnOpenTry: Data.Object({
        client_state: Data.Bytes(),
        proof_init: MerkleProofSchema,
        proof_client: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      BurnConnection: Data.Object({ token: AuthTokenSchema, reclaim_to: Data.Bytes() }),
    }),
  ]);
}

function buildSpendConnectionRedeemerSchema(Data: LucidData) {
  const HeightSchema = createHeightSchema(Data);
  const { MerkleProofSchema } = createIcs23MerkleProofSchema(Data);

  return Data.Enum([
    Data.Literal('ConnOpenAck'),
    Data.Object({
      ConnOpenConfirm: Data.Object({
        proof_ack: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Literal('IncrementChannelCount'),
    Data.Literal('DecrementChannelCount'),
    Data.Object({ BeginConnectionRetirement: Data.Object({ not_before: Data.Integer() }) }),
    Data.Object({ ReclaimConnection: Data.Object({ reclaim_to: Data.Bytes() }) }),
  ]);
}

export async function encodeMintConnectionRedeemer(
  mintConnectionRedeemer: MintConnectionRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const MintConnectionRedeemerSchema = buildMintConnectionRedeemerSchema(Data);
  return Data.to(mintConnectionRedeemer, MintConnectionRedeemerSchema as unknown as MintConnectionRedeemer, {
    canonical: true,
  });
}

export async function encodeSpendConnectionRedeemer(
  spendConnectionRedeemer: SpendConnectionRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const SpendConnectionRedeemerSchema = buildSpendConnectionRedeemerSchema(Data);
  return Data.to(spendConnectionRedeemer, SpendConnectionRedeemerSchema as unknown as SpendConnectionRedeemer, {
    canonical: true,
  });
}

export function decodeMintConnectionRedeemer(
  mintConnectionRedeemer: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): MintConnectionRedeemer {
  const { Data } = Lucid;
  const MintConnectionRedeemerSchema = buildMintConnectionRedeemerSchema(Data);
  return Data.from(mintConnectionRedeemer, MintConnectionRedeemerSchema as unknown as MintConnectionRedeemer);
}

export function decodeSpendConnectionRedeemer(
  spendConnectionRedeemer: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): SpendConnectionRedeemer {
  const { Data } = Lucid;
  const SpendConnectionRedeemerSchema = buildSpendConnectionRedeemerSchema(Data);
  return Data.from(spendConnectionRedeemer, SpendConnectionRedeemerSchema as unknown as SpendConnectionRedeemer);
}
