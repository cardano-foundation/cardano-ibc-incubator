import { AuthToken } from '../auth-token';
import { Data } from 'lucid-cardano';
import { Height } from '../height';
import { Packet } from './packet';

export type MintChannelRedeemer =
  | {
      ChanOpenInit: {
        handler_token: AuthToken;
      };
    }
  | {
      ChanOpenTry: {
        handler_token: AuthToken;
        counterparty_version: string;
        proof_init: string;
        proof_height: Height;
      };
    };

export type SpendChannelRedeemer =
  | {
      ChanOpenAck: {
        counterparty_version: string;
        proof_try: string;
        proof_height: Height;
      };
    }
  | {
      ChanOpenConfirm: {
        proof_ack: string;
        proof_height: Height;
      };
    }
  | {
      RecvPacket: {
        packet: Packet;
        proof_commitment: string;
        proof_height: Height;
      };
    };
export async function encodeMintChannelRedeemer(
  mintChannelRedeemer: MintChannelRedeemer,
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
  const MintChannelRedeemerSchema = Data.Enum([
    Data.Object({
      ChanOpenInit: Data.Object({
        handler_token: AuthTokenSchema,
      }),
    }),
    Data.Object({
      ChanOpenTry: Data.Object({
        handler_token: AuthTokenSchema,
        counterparty_version: Data.Bytes(),
        proof_init: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TMintChannelRedeemer = Data.Static<typeof MintChannelRedeemerSchema>;
  const TMintChannelRedeemer = MintChannelRedeemerSchema as unknown as MintChannelRedeemer;
  return Data.to(mintChannelRedeemer, TMintChannelRedeemer);
}

export async function encodeSpendChannelRedeemer(
  spendChannelRedeemer: SpendChannelRedeemer,
  Lucid: typeof import('lucid-cardano'),
) {
  const { Data } = Lucid;
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const PacketSchema = Data.Object({
    sequence: Data.Integer(),
    source_port: Data.Bytes(),
    source_channel: Data.Bytes(),
    destination_port: Data.Bytes(),
    destination_channel: Data.Bytes(),
    data: Data.Bytes(),
    timeout_height: HeightSchema,
    timeout_timestamp: Data.Integer(),
  });
  const SpendChannelRedeemerSchema = Data.Enum([
    Data.Object({
      ChanOpenAck: Data.Object({
        counterparty_version: Data.Bytes(),
        proof_try: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ChanOpenConfirm: Data.Object({
        proof_ack: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      RecvPacket: Data.Object({
        packet: PacketSchema,
        proof_commitment: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TSpendChannelRedeemer = Data.Static<typeof SpendChannelRedeemerSchema>;
  const TSpendChannelRedeemer = SpendChannelRedeemerSchema as unknown as SpendChannelRedeemer;
  return Data.to(spendChannelRedeemer, TSpendChannelRedeemer);
}

export function decodeMintChannelRedeemer(
  mintChannelRedeemer: string,
  Lucid: typeof import('lucid-cardano'),
): MintChannelRedeemer {
  const { Data } = Lucid;
  const AuthTokenSchema = Data.Object({
    policyId: Data.Bytes(),
    name: Data.Bytes(),
  });
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const MintChannelRedeemerSchema = Data.Enum([
    Data.Object({
      ChanOpenInit: Data.Object({
        handler_token: AuthTokenSchema,
      }),
    }),
    Data.Object({
      ChanOpenTry: Data.Object({
        handler_token: AuthTokenSchema,
        counterparty_version: Data.Bytes(),
        proof_init: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TMintChannelRedeemer = Data.Static<typeof MintChannelRedeemerSchema>;
  const TMintChannelRedeemer = MintChannelRedeemerSchema as unknown as MintChannelRedeemer;
  return Data.from(mintChannelRedeemer, TMintChannelRedeemer);
}

export function decodeSpendChannelRedeemer(
  spendChannelRedeemer: string,
  Lucid: typeof import('lucid-cardano'),
): SpendChannelRedeemer {
  const { Data } = Lucid;
  const HeightSchema = Data.Object({
    revisionNumber: Data.Integer(),
    revisionHeight: Data.Integer(),
  });
  const PacketSchema = Data.Object({
    sequence: Data.Integer(),
    source_port: Data.Bytes(),
    source_channel: Data.Bytes(),
    destination_port: Data.Bytes(),
    destination_channel: Data.Bytes(),
    data: Data.Bytes(),
    timeout_height: HeightSchema,
    timeout_timestamp: Data.Integer(),
  });
  const SpendChannelRedeemerSchema = Data.Enum([
    Data.Object({
      ChanOpenAck: Data.Object({
        counterparty_version: Data.Bytes(),
        proof_try: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ChanOpenConfirm: Data.Object({
        proof_ack: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      RecvPacket: Data.Object({
        packet: PacketSchema,
        proof_commitment: Data.Bytes(),
        proof_height: HeightSchema,
      }),
    }),
  ]);
  type TSpendChannelRedeemer = Data.Static<typeof SpendChannelRedeemerSchema>;
  const TSpendChannelRedeemer = SpendChannelRedeemerSchema as unknown as SpendChannelRedeemer;
  return Data.from(spendChannelRedeemer, TSpendChannelRedeemer);
}
