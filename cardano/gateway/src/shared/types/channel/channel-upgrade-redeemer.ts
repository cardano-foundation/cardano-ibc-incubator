import type {
  ErrorReceiptValue,
  HeightValue,
  UpgradeFieldsValue,
  UpgradeValue,
} from '@cardano-ibc/tx-builder-runtime/channelDatum';
import { channelSchemas } from '@cardano-ibc/tx-builder-runtime/channelDatum';
import { MerkleProof } from '../isc-23/merkle';
import { createHeightSchema, createIcs23MerkleProofSchema } from '../schema-fragments';
import { Channel } from './channel';
import { ChannelState } from './state';

type LucidModule = typeof import('@lucid-evolution/lucid');

/**
 * Mirrors `ChannelUpgradeStep` in cardano/onchain/lib/ibc/core/ics-004/channel_redeemer.ak.
 * Constructor order is part of the redeemer ABI.
 */
export type ChannelUpgradeStep =
  | { InitUpgrade: { fields: UpgradeFieldsValue; timeout_period: bigint } }
  | {
      TryUpgrade: {
        counterparty_upgrade_fields: UpgradeFieldsValue;
        counterparty_upgrade_sequence: bigint;
        proof_channel: MerkleProof;
        proof_upgrade: MerkleProof;
        proof_height: HeightValue;
      };
    }
  | {
      AckUpgrade: {
        counterparty_upgrade: UpgradeValue;
        proof_channel: MerkleProof;
        proof_upgrade: MerkleProof;
        proof_height: HeightValue;
      };
    }
  | {
      ConfirmUpgrade: {
        counterparty_channel_state: ChannelState;
        counterparty_upgrade: UpgradeValue;
        proof_channel: MerkleProof;
        proof_upgrade: MerkleProof;
        proof_height: HeightValue;
      };
    }
  | {
      OpenUpgrade: {
        counterparty_upgrade_sequence: bigint;
        proof_channel: MerkleProof;
        proof_height: HeightValue;
      };
    }
  | {
      TimeoutUpgrade: {
        counterparty_channel: Channel;
        proof_channel: MerkleProof;
        proof_height: HeightValue;
      };
    }
  | {
      CancelUpgrade: {
        error_receipt: ErrorReceiptValue | null;
        proof_error_receipt: MerkleProof;
        proof_height: HeightValue;
      };
    }
  | { FlushUpgrade: { lanes: bigint } };

export type ChannelUpgradeRedeemer = {
  step: ChannelUpgradeStep;
  channel_siblings: string[];
  upgrade_siblings: string[];
  error_receipt_siblings: string[];
};

export type ChannelUpgradeStepName =
  | 'InitUpgrade'
  | 'TryUpgrade'
  | 'AckUpgrade'
  | 'ConfirmUpgrade'
  | 'OpenUpgrade'
  | 'TimeoutUpgrade'
  | 'CancelUpgrade'
  | 'FlushUpgrade';

export function channelUpgradeStepName(step: ChannelUpgradeStep): ChannelUpgradeStepName {
  return Object.keys(step)[0] as ChannelUpgradeStepName;
}

function buildChannelUpgradeRedeemerSchema(Lucid: LucidModule) {
  const { Data } = Lucid;
  const { Channel, Upgrade, ErrorReceipt } = channelSchemas(Lucid);
  const HeightSchema = createHeightSchema(Data);
  const { MerkleProofSchema } = createIcs23MerkleProofSchema(Data);
  const UpgradeFields = Data.Object({
    ordering: Data.Enum([Data.Literal('None'), Data.Literal('Unordered'), Data.Literal('Ordered')]),
    connection_hops: Data.Array(Data.Bytes()),
    version: Data.Bytes(),
  });
  const State = Data.Enum(Object.values(ChannelState).map((state) => Data.Literal(state)) as any);
  const Step = Data.Enum([
    Data.Object({
      InitUpgrade: Data.Object({ fields: UpgradeFields, timeout_period: Data.Integer() }),
    }),
    Data.Object({
      TryUpgrade: Data.Object({
        counterparty_upgrade_fields: UpgradeFields,
        counterparty_upgrade_sequence: Data.Integer(),
        proof_channel: MerkleProofSchema,
        proof_upgrade: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      AckUpgrade: Data.Object({
        counterparty_upgrade: Upgrade,
        proof_channel: MerkleProofSchema,
        proof_upgrade: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      ConfirmUpgrade: Data.Object({
        counterparty_channel_state: State,
        counterparty_upgrade: Upgrade,
        proof_channel: MerkleProofSchema,
        proof_upgrade: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      OpenUpgrade: Data.Object({
        counterparty_upgrade_sequence: Data.Integer(),
        proof_channel: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      TimeoutUpgrade: Data.Object({
        counterparty_channel: Channel,
        proof_channel: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({
      CancelUpgrade: Data.Object({
        error_receipt: Data.Nullable(ErrorReceipt),
        proof_error_receipt: MerkleProofSchema,
        proof_height: HeightSchema,
      }),
    }),
    Data.Object({ FlushUpgrade: Data.Object({ lanes: Data.Integer() }) }),
  ]);
  return Data.Object({
    step: Step,
    channel_siblings: Data.Array(Data.Bytes()),
    upgrade_siblings: Data.Array(Data.Bytes()),
    error_receipt_siblings: Data.Array(Data.Bytes()),
  });
}

/** The redeemer as Plutus data, which `ChanUpgrade` carries opaquely. */
export function channelUpgradeRedeemerData(redeemer: ChannelUpgradeRedeemer, Lucid: LucidModule) {
  const { Data } = Lucid;
  return Data.from(Data.to(redeemer as any, buildChannelUpgradeRedeemerSchema(Lucid) as any, { canonical: true }));
}

export function decodeChannelUpgradeRedeemer(data: unknown, Lucid: LucidModule): ChannelUpgradeRedeemer {
  const { Data } = Lucid;
  return Data.from(Data.to(data as any), buildChannelUpgradeRedeemerSchema(Lucid) as any) as ChannelUpgradeRedeemer;
}
