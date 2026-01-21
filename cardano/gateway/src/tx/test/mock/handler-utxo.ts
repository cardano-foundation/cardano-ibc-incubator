class HandlerUtxoMockBuilder {
  private handlerUtxo: any;

  constructor() {
    this.setDefault();
  }
  private setDefault(): void {
    this.handlerUtxo = {
      txHash: '5ed34c5766f4a005ef4fbea14662a2fdeae92b305516e4fa93c41541c764cdac',
      outputIndex: 0,
      address: 'addr_test1wr2s84md2eghjntunzs6d5sc4gtffvy9gwpdx0ga46tv5wsfj9k50',
      assets: {
        lovelace: 4896160n,
        d8eb6002f13ddcedc0eaea14c1de735ef8bcbd406994e92f8719a78ea5bfc596b369724e49b09ada7ea7c624535ffd4bf2c9db643233:
          1n,
      },
      datumHash: null,
      datum:
        'd87982d8798500000081186458200000000000000000000000000000000000000000000000000000000000000000d87982581c11d98f7566bb47cd0bd738390dd8fa748167206013059a26000334b14768616e646c6572',
      scriptRef: null,
    };
  }
  private reset(): void {
    this.setDefault();
  }
  withTxHash(txHash: string): HandlerUtxoMockBuilder {
    this.handlerUtxo.txHash = txHash;
    return this;
  }

  withOutputIndex(outputIndex: number): HandlerUtxoMockBuilder {
    this.handlerUtxo.outputIndex = outputIndex;
    return this;
  }

  withAddress(address: string): HandlerUtxoMockBuilder {
    this.handlerUtxo.address = address;
    return this;
  }

  withAssets(assets: Record<string, bigint>): HandlerUtxoMockBuilder {
    this.handlerUtxo.assets = assets;
    return this;
  }

  withDatumHash(datumHash: string | null): HandlerUtxoMockBuilder {
    this.handlerUtxo.datumHash = datumHash;
    return this;
  }

  withDatum(datum: string): HandlerUtxoMockBuilder {
    this.handlerUtxo.datum = datum;
    return this;
  }

  withScriptRef(scriptRef: any): HandlerUtxoMockBuilder {
    this.handlerUtxo.scriptRef = scriptRef;
    return this;
  }

  build(): any {
    const builtHandlerUtxo = { ...this.handlerUtxo };
    this.reset();
    return builtHandlerUtxo;
  }
}

const handlerUtxoMockBuilder = new HandlerUtxoMockBuilder();

export default handlerUtxoMockBuilder;
