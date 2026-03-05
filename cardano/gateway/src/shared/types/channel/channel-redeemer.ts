import { AuthToken } from '../auth-token';
import { Height } from '../height';
import { Packet } from './packet';
import { MerkleProof } from '../isc-23/merkle';
import {
  createAuthTokenSchema,
  createHeightSchema,
  createIcs23MerkleProofSchema,
  createPacketSchema,
} from '../schema-fragments';

type LucidData = typeof import('@lucid-evolution/lucid').Data;

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
        proof_init: MerkleProof;
        proof_height: Height;
      };
    };

export type SpendChannelRedeemer =
  | {
      ChanOpenAck: {
        counterparty_version: string;
        proof_try: MerkleProof;
        proof_height: Height;
      };
    }
  | {
      ChanOpenConfirm: {
        proof_ack: MerkleProof;
        proof_height: Height;
      };
    }
  | {
      RecvPacket: {
        packet: Packet;
        proof_commitment: MerkleProof;
        proof_height: Height;
      };
    }
  | {
      TimeoutPacket: {
        packet: Packet;
        proof_unreceived: MerkleProof;
        proof_height: Height;
        next_sequence_recv: bigint;
      };
    }
  | {
      AcknowledgePacket: {
        packet: Packet;
        acknowledgement: string;
        proof_acked: MerkleProof;
        proof_height: Height;
      };
    }
  | {
      SendPacket: {
        packet: Packet;
      };
    }
  | 'ChanCloseInit'
  | {
      ChanCloseConfirm: {
        proof_init: MerkleProof;
        proof_height: Height;
      };
    }
  | 'RefreshUtxo';

function buildMintChannelRedeemerSchema(Data: LucidData) {
  const AuthTokenSchema = createAuthTokenSchema(Data);
  const HeightSchema = createHeightSchema(Data);
  const { MerkleProofSchema } = createIcs23MerkleProofSchema(Data);

  return Data.Enum([
    Data.Object({
      ChanOpenInit: Data.Object({
        handler_token: AuthTokenSchema,
      }),
    }),
    Data.Object({
      ChanOpenTry: Data.Object({
        handler_token: AuthTokenSchema,
        counterparty_version: Data.Bytes(),
        proof_init: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
  ]);
}

function buildSpendChannelRedeemerSchema(Data: LucidData) {
  const HeightSchema = createHeightSchema(Data);
  const { MerkleProofSchema } = createIcs23MerkleProofSchema(Data);
  const PacketSchema = createPacketSchema(Data, HeightSchema);

  return Data.Enum([
    Data.Object({
      ChanOpenAck: Data.Object({
        counterparty_version: Data.Bytes(),
        proof_try: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ChanOpenConfirm: Data.Object({
        proof_ack: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      RecvPacket: Data.Object({
        packet: PacketSchema,
        proof_commitment: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      TimeoutPacket: Data.Object({
        packet: PacketSchema,
        proof_unreceived: MerkleProofSchema,
        proof_height: HeightSchema,
        next_sequence_recv: Data.Integer(),
      }),
    }),
    Data.Object({
      AcknowledgePacket: Data.Object({
        packet: PacketSchema,
        acknowledgement: Data.Bytes(),
        proof_acked: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      SendPacket: Data.Object({
        packet: PacketSchema,
      }),
    }),
    Data.Literal('ChanCloseInit'),
    Data.Object({
      ChanCloseConfirm: Data.Object({
        proof_init: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Literal('RefreshUtxo'),
  ]);
}

export async function encodeMintChannelRedeemer(
  mintChannelRedeemer: MintChannelRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const MintChannelRedeemerSchema = buildMintChannelRedeemerSchema(Data);
  return Data.to(mintChannelRedeemer, MintChannelRedeemerSchema as unknown as MintChannelRedeemer, { canonical: true });
}

export async function encodeSpendChannelRedeemer(
  spendChannelRedeemer: SpendChannelRedeemer,
  Lucid: typeof import('@lucid-evolution/lucid'),
) {
  const { Data } = Lucid;
  const SpendChannelRedeemerSchema = buildSpendChannelRedeemerSchema(Data);
  return Data.to(spendChannelRedeemer, SpendChannelRedeemerSchema as unknown as SpendChannelRedeemer, {
    canonical: true,
  });
}

export function decodeMintChannelRedeemer(
  mintChannelRedeemer: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): MintChannelRedeemer {
  const { Data } = Lucid;
  const MintChannelRedeemerSchema = buildMintChannelRedeemerSchema(Data);
  return Data.from(mintChannelRedeemer, MintChannelRedeemerSchema as unknown as MintChannelRedeemer);
}

export function decodeSpendChannelRedeemer(
  spendChannelRedeemer: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
): SpendChannelRedeemer {
  const { Data } = Lucid;
  const SpendChannelRedeemerSchema = buildSpendChannelRedeemerSchema(Data);
  return Data.from(spendChannelRedeemer, SpendChannelRedeemerSchema as unknown as SpendChannelRedeemer);
}
