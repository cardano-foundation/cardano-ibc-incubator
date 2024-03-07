import { Data } from 'lucid-cardano';
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
  Lucid: typeof import('lucid-cardano'),
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
  return Data.to(ibcModuleRedeemer, TIBCModuleRedeemer);
}

export function decodeIBCModuleRedeemer(ibcModuleRedeemer: string, Lucid: typeof import('lucid-cardano')) {
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
