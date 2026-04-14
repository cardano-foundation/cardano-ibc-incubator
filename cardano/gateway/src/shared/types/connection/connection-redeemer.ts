import { AuthToken } from '../auth-token';
import { Height } from '../height';
import { MerkleProof } from '../isc-23/merkle';
import {
  createAuthTokenSchema,
  createHeightSchema,
  createIcs23MerkleProofSchema,
} from '../schema-fragments';

type LucidData = typeof import('@lucid-evolution/lucid').Data;

export type MintConnectionRedeemer =
  | {
      ConnOpenInit: {
        handler_auth_token: AuthToken;
      };
    }
  | {
      ConnOpenTry: {
        handler_auth_token: AuthToken;
        client_state: string;
        proof_init: MerkleProof;
        proof_client: MerkleProof;
        proof_height: Height;
      };
    };

export type SpendConnectionRedeemer =
  | {
      ConnOpenAck: {
        counterparty_client_state: string;
        proof_try: MerkleProof;
        proof_client: MerkleProof;
        proof_height: Height;
      };
    }
  | {
      ConnOpenConfirm: {
        proof_ack: MerkleProof;
        proof_height: Height;
      };
    };

function buildMintConnectionRedeemerSchema(Data: LucidData) {
  const AuthTokenSchema = createAuthTokenSchema(Data);
  const HeightSchema = createHeightSchema(Data);
  const { MerkleProofSchema } = createIcs23MerkleProofSchema(Data);

  return Data.Enum([
    Data.Object({
      ConnOpenInit: Data.Object({
        handler_auth_token: AuthTokenSchema,
      }),
    }),
    Data.Object({
      ConnOpenTry: Data.Object({
        handler_auth_token: AuthTokenSchema,
        client_state: Data.Bytes(),
        proof_init: MerkleProofSchema,
        proof_client: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
  ]);
}

function buildSpendConnectionRedeemerSchema(Data: LucidData) {
  const HeightSchema = createHeightSchema(Data);
  const { MerkleProofSchema } = createIcs23MerkleProofSchema(Data);

  return Data.Enum([
    Data.Object({
      ConnOpenAck: Data.Object({
        counterparty_client_state: Data.Bytes(),
        proof_try: MerkleProofSchema,
        proof_client: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ConnOpenConfirm: Data.Object({
        proof_ack: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
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
