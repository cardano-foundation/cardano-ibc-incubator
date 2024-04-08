import { MsgTransfer } from '@cosmjs-types/src/ibc/core/channel/v1/tx';

class MsgSendPacketMockBuilder {
  private msgSendPacket: MsgTransfer;

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.msgSendPacket = {
      source_port: 'port-100',
      source_channel: 'channel-14',
      token: {
        denom: '9fc33a6ffaa8d1f600c161aa383739d5af37807ed83347cc133521c96d6f636b',
        amount: 3000n,
      },
      sender: '247570b8ba7dc725e9ff37e9757b8148b4d5a125958edac2fd4417b8',
      receiver: 'cosmos1ycel53a5d9xk89q3vdr7vm839t2vwl08pl6zk6',
      timeout_height: null,
      timeout_timestamp: 968124724398584011n,
      memo: '',
    };
  }
  reset(): void {
    this.setDefault();
  }

  withSourcePort(sourcePort: string): MsgSendPacketMockBuilder {
    this.msgSendPacket.source_port = sourcePort;
    return this;
  }

  withSourceChannel(sourceChannel: string): MsgSendPacketMockBuilder {
    this.msgSendPacket.source_channel = sourceChannel;
    return this;
  }

  withTokenDenom(denom: string): MsgSendPacketMockBuilder {
    this.msgSendPacket.token.denom = denom;
    return this;
  }

  withSender(sender: string): MsgSendPacketMockBuilder {
    this.msgSendPacket.sender = sender;
    return this;
  }

  withReceiver(receiver: string): MsgSendPacketMockBuilder {
    this.msgSendPacket.receiver = receiver;
    return this;
  }

  withTimeoutHeight(timeoutHeight: any): MsgSendPacketMockBuilder {
    this.msgSendPacket.timeout_height = timeoutHeight;
    return this;
  }

  build(): any {
    const builtMsgSendPacket = { ...this.msgSendPacket };
    this.reset();
    return builtMsgSendPacket;
  }
}

const msgSendPacketMockBuilder = new MsgSendPacketMockBuilder();

export default msgSendPacketMockBuilder;
