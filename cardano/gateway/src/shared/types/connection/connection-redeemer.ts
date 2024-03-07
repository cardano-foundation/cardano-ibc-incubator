import { AuthToken } from '../auth-token';
import { Data } from 'lucid-cardano';
import { Height } from '../height';

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
        proof_init: string;
        proof_client: string;
        proof_height: Height;
      };
    };
export type SpendConnectionRedeemer =
  | {
      ConnOpenAck: {
        counterparty_client_state: string;
        proof_try: string;
        proof_client: string;
        proof_height: Height;
      };
    }
  | {
      ConnOpenConfirm: {
        proof_ack: string;
        proof_height: Height;
      };
    };
export async function encodeMintConnectionRedeemer(
  mintConnectionRedeemer: MintConnectionRedeemer,
  Lucid: typeof import('lucid-cardano'),
) {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const MintConnectionRedeemerSchema = Data.Enum([
    Data.Object({
      ConnOpenInit: Data.Object({
        handler_auth_token: AuthTokenSchema,
      }),
    }),
    Data.Object({
      ConnOpenTry: Data.Object({
        handler_auth_token: AuthTokenSchema,
        client_state: Data.Bytes(),
        proof_init: Data.Bytes(),
        proof_client: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TMintConnectionRedeemer = Data.Static<typeof MintConnectionRedeemerSchema>;
  const TMintConnectionRedeemer = MintConnectionRedeemerSchema as unknown as MintConnectionRedeemer;
  return Data.to(mintConnectionRedeemer, TMintConnectionRedeemer);
}
export async function encodeSpendConnectionRedeemer(
  spendConnectionRedeemer: SpendConnectionRedeemer,
  Lucid: typeof import('lucid-cardano'),
) {
  const { Data } = Lucid;
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const SpendConnectionRedeemerSchema = Data.Enum([
    Data.Object({
      ConnOpenAck: Data.Object({
        counterparty_client_state: Data.Bytes(),
        proof_try: Data.Bytes(),
        proof_client: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ConnOpenConfirm: Data.Object({
        proof_ack: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TSpendConnectionRedeemer = Data.Static<typeof SpendConnectionRedeemerSchema>;
  const TSpendConnectionRedeemer = SpendConnectionRedeemerSchema as unknown as SpendConnectionRedeemer;
  return Data.to(spendConnectionRedeemer, TSpendConnectionRedeemer);
}

export function decodeMintConnectionRedeemer(
  mintConnectionRedeemer: string,
  Lucid: typeof import('lucid-cardano'),
): MintConnectionRedeemer {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const MintConnectionRedeemerSchema = Data.Enum([
    Data.Object({
      ConnOpenInit: Data.Object({
        handler_auth_token: AuthTokenSchema,
      }),
    }),
    Data.Object({
      ConnOpenTry: Data.Object({
        handler_auth_token: AuthTokenSchema,
        client_state: Data.Bytes(),
        proof_init: Data.Bytes(),
        proof_client: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TMintConnectionRedeemer = Data.Static<typeof MintConnectionRedeemerSchema>;
  const TMintConnectionRedeemer = MintConnectionRedeemerSchema as unknown as MintConnectionRedeemer;
  return Data.from(mintConnectionRedeemer, TMintConnectionRedeemer);
}
export function decodeSpendConnectionRedeemer(
  spendConnectionRedeemer: string,
  Lucid: typeof import('lucid-cardano'),
): SpendConnectionRedeemer {
  const { Data } = Lucid;
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const SpendConnectionRedeemerSchema = Data.Enum([
    Data.Object({
      ConnOpenAck: Data.Object({
        counterparty_client_state: Data.Bytes(),
        proof_try: Data.Bytes(),
        proof_client: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ConnOpenConfirm: Data.Object({
        proof_ack: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TSpendConnectionRedeemer = Data.Static<typeof SpendConnectionRedeemerSchema>;
  const TSpendConnectionRedeemer = SpendConnectionRedeemerSchema as unknown as SpendConnectionRedeemer;
  return Data.from(spendConnectionRedeemer, TSpendConnectionRedeemer);
}
