import { Data } from '@dinhbx/lucid-custom';
import { Acknowledgement } from '../channel/acknowledgement';
import { TransferModuleRedeemer } from '../apps/transfer/transfer_module_redeemer/transfer-module-redeemer';
import { FungibleTokenPacketDatum } from '../apps/transfer/types/fungible-token-packet-data';

export type IBCModulePacketData =
  | {
      TransferModuleData: FungibleTokenPacketDatum[];
    }
  | 'OtherModuleData';

export type IBCModuleCallback =
  | {
      OnChanOpenInit: {
        channel_id: string;
      };
    }
  | {
      OnChanOpenTry: {
        channel_id: string;
      };
    }
  | {
      OnChanOpenAck: {
        channel_id: string;
      };
    }
  | {
      OnChanOpenConfirm: {
        channel_id: string;
      };
    }
  | {
      OnRecvPacket: {
        channel_id: string;
        acknowledgement: Acknowledgement;
        data: IBCModulePacketData;
      };
    }
  | {
      OnTimeoutPacket: {
        channel_id: string;
        data: IBCModulePacketData;
      };
    }
  | {
      OnAcknowledgementPacket: {
        channel_id: string;
        acknowledgement: Acknowledgement;
        data: IBCModulePacketData;
      };
    }
  | {
      OnChanCloseInit: {
        channel_id: string;
      };
    }
  | {
      OnChanOpenConfirm: 
      {
        channel_id: string;
      };
    };

export type IBCModuleOperator =
  | {
      TransferModuleOperator: TransferModuleRedeemer[];
    }
  | 'OtherModuleOperator';

export type IBCModuleRedeemer =
  | {
      Callback: IBCModuleCallback[];
    }
  | {
      Operator: IBCModuleOperator[];
    };
export async function encodeIBCModuleRedeemer(
  ibcModuleRedeemer: IBCModuleRedeemer,
  Lucid: typeof import('@dinhbx/lucid-custom'),
) {
  const { Data } = Lucid;
  const AcknowledgementResponseSchema = Data.Enum([
    Data.Object({
      AcknowledgementResult: Data.Object({
        result: Data.Bytes(),
      }),
    }),
    Data.Object({
      AcknowledgementError: Data.Object({
        err: Data.Bytes(),
      }),
    }),
  ]);
  const AcknowledgementSchema = Data.Object({
    response: AcknowledgementResponseSchema,
  });

  const FungibleTokenPacketDatumSchema = Data.Object({
    denom: Data.Bytes(),
    amount: Data.Bytes(),
    sender: Data.Bytes(),
    receiver: Data.Bytes(),
    memo: Data.Bytes(),
  });

  const IBCModulePacketData = Data.Enum([
    Data.Object({
      TransferModuleData: Data.Tuple([FungibleTokenPacketDatumSchema]),
    }),
    Data.Literal('OtherModuleData'),
  ]);

  const IBCModuleCallbackSchema = Data.Enum([
    Data.Object({
      OnChanOpenInit: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnChanOpenTry: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnChanOpenAck: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnChanOpenConfirm: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnChanCloseInit: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnChanCloseConfirm: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnRecvPacket: Data.Object({
        channel_id: Data.Bytes(),
        acknowledgement: AcknowledgementSchema,
        data: IBCModulePacketData,
      }),
    }),
    Data.Object({
      OnTimeoutPacket: Data.Object({
        channel_id: Data.Bytes(),
        data: IBCModulePacketData,
      }),
    }),
    Data.Object({
      OnAcknowledgementPacket: Data.Object({
        channel_id: Data.Bytes(),
        acknowledgement: AcknowledgementSchema,
        data: IBCModulePacketData,
      }),
    }),
  ]);

  const TransferModuleRedeemerSchema = Data.Enum([
    Data.Object({
      Transfer: Data.Object({
        channel_id: Data.Bytes(),
        data: FungibleTokenPacketDatumSchema,
      }),
    }),
    Data.Literal('OtherTransferOp'),
  ]);
  const IBCModuleOperatorSchema = Data.Enum([
    Data.Object({
      TransferModuleOperator: Data.Tuple([TransferModuleRedeemerSchema]),
    }),
    Data.Literal('OtherModuleOperator'),
  ]);

  const IBCModuleRedeemerSchema = Data.Enum([
    Data.Object({
      Callback: Data.Tuple([IBCModuleCallbackSchema]),
    }),
    Data.Object({
      Operator: Data.Tuple([IBCModuleOperatorSchema]),
    }),
  ]);

  type TIBCModuleRedeemer = Data.Static<typeof IBCModuleRedeemerSchema>;
  const TIBCModuleRedeemer = IBCModuleRedeemerSchema as unknown as IBCModuleRedeemer;
  return Data.to(ibcModuleRedeemer, TIBCModuleRedeemer);
}

export function decodeIBCModuleRedeemer(ibcModuleRedeemer: string, Lucid: typeof import('@dinhbx/lucid-custom')) {
  const { Data } = Lucid;
  const AcknowledgementResponseSchema = Data.Enum([
    Data.Object({
      AcknowledgementResult: Data.Object({
        result: Data.Bytes(),
      }),
    }),
    Data.Object({
      AcknowledgementError: Data.Object({
        err: Data.Bytes(),
      }),
    }),
  ]);
  const AcknowledgementSchema = Data.Object({
    response: AcknowledgementResponseSchema,
  });

  const FungibleTokenPacketDatumSchema = Data.Object({
    denom: Data.Bytes(),
    amount: Data.Bytes(),
    sender: Data.Bytes(),
    receiver: Data.Bytes(),
    memo: Data.Bytes(),
  });

  const IBCModulePacketData = Data.Enum([
    Data.Object({
      TransferModuleData: Data.Tuple([FungibleTokenPacketDatumSchema]),
    }),
    Data.Literal('OtherModuleData'),
  ]);

  const IBCModuleCallbackSchema = Data.Enum([
    Data.Object({
      OnChanOpenInit: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnChanOpenTry: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnChanOpenAck: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnChanOpenConfirm: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnChanCloseInit: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnChanCloseConfirm: Data.Object({
        channel_id: Data.Bytes(),
      }),
    }),
    Data.Object({
      OnRecvPacket: Data.Object({
        channel_id: Data.Bytes(),
        acknowledgement: AcknowledgementSchema,
        data: IBCModulePacketData,
      }),
    }),
    Data.Object({
      OnTimeoutPacket: Data.Object({
        channel_id: Data.Bytes(),
        data: IBCModulePacketData,
      }),
    }),
    Data.Object({
      OnAcknowledgementPacket: Data.Object({
        channel_id: Data.Bytes(),
        acknowledgement: AcknowledgementSchema,
        data: IBCModulePacketData,
      }),
    }),
  ]);

  const TransferModuleRedeemerSchema = Data.Enum([
    Data.Object({
      Transfer: Data.Object({
        channel_id: Data.Bytes(),
        data: FungibleTokenPacketDatumSchema,
      }),
    }),
    Data.Literal('OtherTransferOp'),
  ]);
  const IBCModuleOperatorSchema = Data.Enum([
    Data.Object({
      TransferModuleOperator: Data.Tuple([TransferModuleRedeemerSchema]),
    }),
    Data.Literal('OtherModuleOperator'),
  ]);

  const IBCModuleRedeemerSchema = Data.Enum([
    Data.Object({
      Callback: Data.Tuple([IBCModuleCallbackSchema]),
    }),
    Data.Object({
      Operator: Data.Tuple([IBCModuleOperatorSchema]),
    }),
  ]);
  type TIBCModuleRedeemer = Data.Static<typeof IBCModuleRedeemerSchema>;
  const TIBCModuleRedeemer = IBCModuleRedeemerSchema as unknown as IBCModuleRedeemer;
  return Data.from(ibcModuleRedeemer, TIBCModuleRedeemer);
}
