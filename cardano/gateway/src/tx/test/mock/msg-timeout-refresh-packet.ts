import { MsgTimeoutRefresh } from '@cosmjs-types/src/ibc/core/channel/v1/tx';

class MsgTimeoutRefreshMockBuilder {
  private msgTimeoutRefreshMock: MsgTimeoutRefresh;

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.msgTimeoutRefreshMock = {
      channel_id: 'channel-14',
      signer: 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql',
    };
  }
  withChannelId(channelId: string): MsgTimeoutRefreshMockBuilder {
    this.msgTimeoutRefreshMock.channel_id = channelId;
    return this;
  }

  withSigner(signer: string): MsgTimeoutRefreshMockBuilder {
    this.msgTimeoutRefreshMock.signer = signer;
    return this;
  }
  reset(): void {
    this.setDefault();
  }

  build(): any {
    const builtMsgTimeoutRefreshMock = { ...this.msgTimeoutRefreshMock };
    this.reset();
    return builtMsgTimeoutRefreshMock;
  }
}

const msgTimeoutRefreshMockBuilder = new MsgTimeoutRefreshMockBuilder();

export default msgTimeoutRefreshMockBuilder;
