import {Data} from '../../../../plutus/data';
import {AcknowledgementSchema} from '../../../ics_004/types/acknowledgement/Acknowledgement';
import {IBCModulePacketDataSchema} from './IBCModulePacketData';

export const IBCModuleCallbackSchema = Data.Enum([
  Data.Object({OnChanOpenInit: Data.Object({channel_id: Data.Bytes()})}),
  Data.Object({OnChanOpenInit: Data.Object({channel_id: Data.Bytes()})}),
  Data.Object({OnChanOpenTry: Data.Object({channel_id: Data.Bytes()})}),
  Data.Object({OnChanOpenTry: Data.Object({channel_id: Data.Bytes()})}),
  Data.Object({OnChanOpenAck: Data.Object({channel_id: Data.Bytes()})}),
  Data.Object({OnChanOpenAck: Data.Object({channel_id: Data.Bytes()})}),
  Data.Object({OnChanOpenConfirm: Data.Object({channel_id: Data.Bytes()})}),
  Data.Object({OnChanOpenConfirm: Data.Object({channel_id: Data.Bytes()})}),
  Data.Object({OnChanCloseInit: Data.Object({channel_id: Data.Bytes()})}),
  Data.Object({OnChanCloseInit: Data.Object({channel_id: Data.Bytes()})}),
  Data.Object({
    OnChanCloseConfirm: Data.Object({channel_id: Data.Bytes()}),
  }),
  Data.Object({
    OnChanCloseConfirm: Data.Object({channel_id: Data.Bytes()}),
  }),
  Data.Object({
    OnRecvPacket: Data.Object({
      channel_id: Data.Bytes(),
      acknowledgement: AcknowledgementSchema,
      data: IBCModulePacketDataSchema,
    }),
  }),
  Data.Object({
    OnRecvPacket: Data.Object({
      channel_id: Data.Bytes(),
      acknowledgement: AcknowledgementSchema,
      data: IBCModulePacketDataSchema,
    }),
  }),
  Data.Object({
    OnTimeoutPacket: Data.Object({
      channel_id: Data.Bytes(),
      data: IBCModulePacketDataSchema,
    }),
  }),
  Data.Object({
    OnTimeoutPacket: Data.Object({
      channel_id: Data.Bytes(),
      data: IBCModulePacketDataSchema,
    }),
  }),
  Data.Object({
    OnAcknowledgementPacket: Data.Object({
      channel_id: Data.Bytes(),
      acknowledgement: AcknowledgementSchema,
      data: IBCModulePacketDataSchema,
    }),
  }),
  Data.Object({
    OnAcknowledgementPacket: Data.Object({
      channel_id: Data.Bytes(),
      acknowledgement: AcknowledgementSchema,
      data: IBCModulePacketDataSchema,
    }),
  }),
]);
export type IBCModuleCallback = Data.Static<typeof IBCModuleCallbackSchema>;
export const IBCModuleCallback = IBCModuleCallbackSchema as unknown as IBCModuleCallback;
