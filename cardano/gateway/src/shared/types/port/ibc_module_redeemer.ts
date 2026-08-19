import { Data } from '@lucid-evolution/lucid';
import { Acknowledgement } from '../channel/acknowledgement';

// The application payload is deliberately opaque to the core module interface.
// `ModuleDataV1` keeps the former constructor index and one-field layout, so this
// source-level decoupling is byte-compatible with the previous transfer-specific
// application-specific constructor.
export type IBCModulePacketData<TModuleData = Data> =
  | {
      ModuleDataV1: TModuleData[];
    }
  | 'OtherModuleData';

export type IBCModuleCallback<TModuleData = Data> =
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
        packet_data: string;
        acknowledgement: Acknowledgement;
        data: IBCModulePacketData<TModuleData>;
      };
    }
  | {
      OnTimeoutPacket: {
        channel_id: string;
        packet_data: string;
        data: IBCModulePacketData<TModuleData>;
      };
    }
  | {
      OnAcknowledgementPacket: {
        channel_id: string;
        packet_data: string;
        acknowledgement: Acknowledgement;
        data: IBCModulePacketData<TModuleData>;
      };
    }
  | {
      OnChanCloseInit: {
        channel_id: string;
      };
    }
  | {
      OnChanCloseConfirm: {
        channel_id: string;
      };
    }
  | {
      OnSendPacket: {
        channel_id: string;
        packet_data: string;
        packet_commitment: string;
        data: IBCModulePacketData<TModuleData>;
      };
    };

// As with ModuleDataV1, the operator is opaque core Data. The application that
// owns the module output is responsible for decoding and validating it.
export type IBCModuleOperator<TModuleOperator = Data> =
  | {
      ModuleOperatorV1: TModuleOperator[];
    }
  | 'OtherModuleOperator';

export type IBCModuleRedeemer<TModuleData = Data, TModuleOperator = Data> =
  | {
      Callback: IBCModuleCallback<TModuleData>[];
    }
  | {
      Operator: IBCModuleOperator<TModuleOperator>[];
    };

export type IBCModuleCodecSchemas = {
  moduleData?: unknown;
  moduleOperator?: unknown;
};

/**
 * Build the core callback schema around application-owned payload schemas.
 * The defaults decode arbitrary Plutus Data and are suitable for core query
 * paths that never interpret the application payload.
 */
export function ibcModuleRedeemerSchema(
  Lucid: typeof import('@lucid-evolution/lucid'),
  schemas: IBCModuleCodecSchemas = {},
) {
  const { Data } = Lucid;
  const moduleDataSchema = schemas.moduleData ?? Data.Any();
  const moduleOperatorSchema = schemas.moduleOperator ?? Data.Any();

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

  const IBCModulePacketDataSchema = Data.Enum([
    Data.Object({
      ModuleDataV1: Data.Tuple([moduleDataSchema as never]),
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
        packet_data: Data.Bytes(),
        acknowledgement: AcknowledgementSchema,
        data: IBCModulePacketDataSchema,
      }),
    }),
    Data.Object({
      OnTimeoutPacket: Data.Object({
        channel_id: Data.Bytes(),
        packet_data: Data.Bytes(),
        data: IBCModulePacketDataSchema,
      }),
    }),
    Data.Object({
      OnAcknowledgementPacket: Data.Object({
        channel_id: Data.Bytes(),
        packet_data: Data.Bytes(),
        acknowledgement: AcknowledgementSchema,
        data: IBCModulePacketDataSchema,
      }),
    }),
    Data.Object({
      OnSendPacket: Data.Object({
        channel_id: Data.Bytes(),
        packet_data: Data.Bytes(),
        packet_commitment: Data.Bytes(),
        data: IBCModulePacketDataSchema,
      }),
    }),
  ]);

  const IBCModuleOperatorSchema = Data.Enum([
    Data.Object({
      ModuleOperatorV1: Data.Tuple([moduleOperatorSchema as never]),
    }),
    Data.Literal('OtherModuleOperator'),
  ]);

  return Data.Enum([
    Data.Object({
      Callback: Data.Tuple([IBCModuleCallbackSchema]),
    }),
    Data.Object({
      Operator: Data.Tuple([IBCModuleOperatorSchema]),
    }),
  ]);
}

export async function encodeIBCModuleRedeemer<TModuleData = Data, TModuleOperator = Data>(
  ibcModuleRedeemer: IBCModuleRedeemer<TModuleData, TModuleOperator>,
  Lucid: typeof import('@lucid-evolution/lucid'),
  schemas: IBCModuleCodecSchemas = {},
) {
  const schema = ibcModuleRedeemerSchema(Lucid, schemas);
  return Lucid.Data.to(ibcModuleRedeemer as never, schema as never, {
    canonical: true,
  });
}

export function decodeIBCModuleRedeemer<TModuleData = Data, TModuleOperator = Data>(
  ibcModuleRedeemer: string,
  Lucid: typeof import('@lucid-evolution/lucid'),
  schemas: IBCModuleCodecSchemas = {},
): IBCModuleRedeemer<TModuleData, TModuleOperator> {
  const schema = ibcModuleRedeemerSchema(Lucid, schemas);
  return Lucid.Data.from(ibcModuleRedeemer, schema as never) as IBCModuleRedeemer<TModuleData, TModuleOperator>;
}
