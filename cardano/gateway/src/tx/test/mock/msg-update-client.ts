import { MsgUpdateClient } from '@plus/proto-types/build/ibc/core/client/v1/tx';
import headerMockBuilder from './header';

export class MsgUpdateClientMockBuilder {
  private msgUpdateClientMock: MsgUpdateClient;

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.msgUpdateClientMock = {
      client_id: '07-tendermint-1',
      client_message: {
        type_url: '',
        value: headerMockBuilder.encode(),
      },
      signer: 'addr_test1vz8nzrmel9mmmu97lm06uvm55cj7vny6dxjqc0y0efs8mtqsd8r5m',
    };
  }

  reset(): void {
    this.setDefault();
  }

  withClientId(clientId: string): MsgUpdateClientMockBuilder {
    this.msgUpdateClientMock.client_id = clientId;
    return this;
  }

  withClientMessage(value: Buffer): MsgUpdateClientMockBuilder {
    this.msgUpdateClientMock.client_message.value = value;

    return this;
  }
  withTypeUrl(typeUrl: string): MsgUpdateClientMockBuilder {
    this.msgUpdateClientMock.client_message.type_url = typeUrl;
    return this;
  }

  withSigner(signer: string): MsgUpdateClientMockBuilder {
    this.msgUpdateClientMock.signer = signer;
    return this;
  }

  build(): any {
    const builtMsgUpdateClientMock = { ...this.msgUpdateClientMock };
    this.reset();
    return builtMsgUpdateClientMock;
  }
}

const msgUpdateClientMockBuilder = new MsgUpdateClientMockBuilder();

export default msgUpdateClientMockBuilder;
