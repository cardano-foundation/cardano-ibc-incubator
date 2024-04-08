import { MsgChannelOpenInit } from '@cosmjs-types/src/ibc/core/channel/v1/tx';

class MsgChannelOpenInitMockBuilder {
  private msgChannelOpenInit: MsgChannelOpenInit;

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.msgChannelOpenInit = {
      channel: {
        connection_hops: ['connection-0'],
        counterparty: {
          channel_id: 'nisi ad voluptate commodo',
          port_id: 'bank',
        },
        ordering: 1,
        state: 0,
        version: '',
      },
      port_id: 'bank',
      signer: 'addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m',
    };
  }

  reset(): void {
    this.setDefault();
  }

  withConnectionHops(connectionHops: string[]): MsgChannelOpenInitMockBuilder {
    this.msgChannelOpenInit.channel.connection_hops = connectionHops;
    return this;
  }

  withCounterpartyChannelId(channelId: string): MsgChannelOpenInitMockBuilder {
    this.msgChannelOpenInit.channel.counterparty.channel_id = channelId;
    return this;
  }

  withCounterpartyPortId(portId: string): MsgChannelOpenInitMockBuilder {
    this.msgChannelOpenInit.channel.counterparty.port_id = portId;
    return this;
  }

  withOrdering(ordering: number): MsgChannelOpenInitMockBuilder {
    this.msgChannelOpenInit.channel.ordering = ordering;
    return this;
  }

  withState(state: number): MsgChannelOpenInitMockBuilder {
    this.msgChannelOpenInit.channel.state = state;
    return this;
  }

  withVersion(version: string): MsgChannelOpenInitMockBuilder {
    this.msgChannelOpenInit.channel.version = version;
    return this;
  }

  withPortId(portId: string): MsgChannelOpenInitMockBuilder {
    this.msgChannelOpenInit.port_id = portId;
    return this;
  }

  withSigner(signer: string): MsgChannelOpenInitMockBuilder {
    this.msgChannelOpenInit.signer = signer;
    return this;
  }

  build(): any {
    const builtMsgChannelOpenInit = { ...this.msgChannelOpenInit };
    this.reset();
    return builtMsgChannelOpenInit;
  }
}

const msgChannelOpenInitMockBuilder = new MsgChannelOpenInitMockBuilder();

export default msgChannelOpenInitMockBuilder;
