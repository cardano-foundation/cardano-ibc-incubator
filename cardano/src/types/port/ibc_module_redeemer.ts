import { Data } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { AcknowledgementSchema } from "../channel/acknowledgement.ts";

export const IBCModuleCallbackSchema = Data.Enum([
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
export type IBCModuleCallback = Data.Static<typeof IBCModuleCallbackSchema>;
export const IBCModuleCallback =
  IBCModuleCallbackSchema as unknown as IBCModuleCallback;

export const IBCModuleRedeemerSchema = Data.Enum([
  Data.Object({
    Callback: Data.Tuple([IBCModuleCallbackSchema]),
  }),
  Data.Object({
    Operator: Data.Tuple([Data.Any()]),
  }),
]);
export type IBCModuleRedeemer = Data.Static<typeof IBCModuleRedeemerSchema>;
export const IBCModuleRedeemer =
  IBCModuleRedeemerSchema as unknown as IBCModuleRedeemer;
