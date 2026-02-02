import { MsgConnectionOpenInit } from '@plus/proto-types/build/ibc/core/connection/v1/tx';

class MsgConnectionOpenInitMockBuilder {
  private msg: MsgConnectionOpenInit;
  constructor() {
    this.setDefault();
  }

  setDefault() {
    this.msg = {
      client_id: '07-tendermint-0',
      counterparty: {
        client_id: '08-cardano-54',
        prefix: { key_prefix: Buffer.from([105, 98, 99]) },
        connection_id: '',
      },
      delay_period: 0n,
      signer: 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql',
    };
  }

  reset() {
    this.setDefault();
  }

  withClientId(clientId: string): MsgConnectionOpenInitMockBuilder {
    this.msg.client_id = clientId;
    return this;
  }

  withCounterpartyClientId(counterpartyClientId: string): MsgConnectionOpenInitMockBuilder {
    this.msg.counterparty.client_id = counterpartyClientId;
    return this;
  }

  withCounterpartyPrefix(prefix: Buffer): MsgConnectionOpenInitMockBuilder {
    this.msg.counterparty.prefix.key_prefix = prefix;
    return this;
  }

  withSigner(signer: string): MsgConnectionOpenInitMockBuilder {
    this.msg.signer = signer;
    return this;
  }

  build() {
    const builtMsg = { ...this.msg };
    this.reset();
    return builtMsg;
  }
}

const msgConnectionOpenInitMockBuilder = new MsgConnectionOpenInitMockBuilder();

export default msgConnectionOpenInitMockBuilder;
