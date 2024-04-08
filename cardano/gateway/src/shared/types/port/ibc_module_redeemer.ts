import { Data } from '@dinhbx/lucid-custom';
import { Acknowledgement } from '../channel/acknowledgement';
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
        data: any;
      };
    }
  | {
      OnTimeoutPacket: {
        channel_id: string;
        data: any;
      };
    }
  | {
      OnAcknowledgementPacket: {
        channel_id: string;
        acknowledgement: Acknowledgement;
        data: any;
      };
    };

export type IBCModuleRedeemer =
  | {
      Callback: IBCModuleCallback[];
    }
  | {
      Operator: any[];
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
      OnRecvPacket: Data.Object({
        channel_id: Data.Bytes(),
        acknowledgement: AcknowledgementSchema,
        data: Data.Any(),
      }),
    }),
    Data.Object({
      OnTimeoutPacket: Data.Object({
        channel_id: Data.Bytes(),
        data: Data.Any(),
      }),
    }),
    Data.Object({
      OnAcknowledgementPacket: Data.Object({
        channel_id: Data.Bytes(),
        acknowledgement: AcknowledgementSchema,
        data: Data.Any(),
      }),
    }),
  ]);
  const IBCModuleRedeemerSchema = Data.Enum([
    Data.Object({
      Callback: Data.Tuple([IBCModuleCallbackSchema]),
    }),
    Data.Object({
      Operator: Data.Tuple([Data.Any()]),
    }),
  ]);

  if (ibcModuleRedeemer.hasOwnProperty('Operator')) {
    const FungibleTokenPacketDataSchema = Data.Object({
      denom: Data.Bytes(),
      amount: Data.Bytes(),
      sender: Data.Bytes(),
      receiver: Data.Bytes(),
      memo: Data.Bytes(),
    });

    const TransferModuleRedeemerSchema = Data.Enum([
      Data.Object({
        Transfer: Data.Object({
          channel_id: Data.Bytes(),
          data: FungibleTokenPacketDataSchema,
        }),
      }),

      Data.Literal('OtherTransferOp'),
    ]);
    ibcModuleRedeemer['Operator'] = [Data.castTo(ibcModuleRedeemer['Operator'][0], TransferModuleRedeemerSchema)];
  }

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
      OnRecvPacket: Data.Object({
        channel_id: Data.Bytes(),
        acknowledgement: AcknowledgementSchema,
        data: Data.Any(),
      }),
    }),
    Data.Object({
      OnTimeoutPacket: Data.Object({
        channel_id: Data.Bytes(),
        data: Data.Any(),
      }),
    }),
    Data.Object({
      OnAcknowledgementPacket: Data.Object({
        channel_id: Data.Bytes(),
        acknowledgement: AcknowledgementSchema,
        data: Data.Any(),
      }),
    }),
  ]);
  const IBCModuleRedeemerSchema = Data.Enum([
    Data.Object({
      Callback: Data.Tuple([IBCModuleCallbackSchema]),
    }),
    Data.Object({
      Operator: Data.Tuple([Data.Any()]),
    }),
  ]);
  type TIBCModuleRedeemer = Data.Static<typeof IBCModuleRedeemerSchema>;
  const TIBCModuleRedeemer = IBCModuleRedeemerSchema as unknown as IBCModuleRedeemer;
  return Data.from(ibcModuleRedeemer, TIBCModuleRedeemer);
}
