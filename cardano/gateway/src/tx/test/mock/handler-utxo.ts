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
        'd8799fd8799fd8799f4973696465636861696ed8799f0103ff1b00004e94914f00001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f001a000271ebff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffa7d8799f001a00027186ffd8799f1b17c1c07034199cc85820c5120d858da3e00ec587ee8a4c93cb0f56a50ae00951dd8b148454983ae2b995d8799f5820a8fae87c62365c792053de4e83bab983e30ede44d79e631fcd57f785012e6d5bffffd8799f001a0002718bffd8799f1b17c1c071684593985820c5120d858da3e00ec587ee8a4c93cb0f56a50ae00951dd8b148454983ae2b995d8799f5820462259249c874f6975d62ee10628d999f6f6ba7df0281e6c7383700bc4f8c1d4ffffd8799f001a000271a1ffd8799f1b17c1c076b2515c615820c5120d858da3e00ec587ee8a4c93cb0f56a50ae00951dd8b148454983ae2b995d8799f582067cde7d8929d242e84a8b386500d60614f1ebc20997e3817a53c7b5dbf1d4063ffffd8799f001a000271b2ffd8799f1b17c1c07acbcbabf45820c5120d858da3e00ec587ee8a4c93cb0f56a50ae00951dd8b148454983ae2b995d8799f5820a39277ace082b84230e448e01ab12b7718a6a7fb4513006a1e9dd15a23a823a5ffffd8799f001a000271c9ffd8799f1b17c1c08055c07c5b5820c5120d858da3e00ec587ee8a4c93cb0f56a50ae00951dd8b148454983ae2b995d8799f5820cefd9b0d560543262caebd9616baf13e50ce5e8b16364ec651581617660df49cffffd8799f001a000271ddffd8799f1b17c1c08524f691345820c5120d858da3e00ec587ee8a4c93cb0f56a50ae00951dd8b148454983ae2b995d8799f5820e8860a3693637ad42a4634e4a0a67b2921b61df33aa220a26fc77a514c2d124affffd8799f001a000271ebffd8799f1b17c1c08885613f7a5820c5120d858da3e00ec587ee8a4c93cb0f56a50ae00951dd8b148454983ae2b995d8799f5820a8feba1e4225992d8abf55f4f21aadf12cbef53d0154ea06805bd17523dd241affffffd8799f581cd8eb6002f13ddcedc0eaea14c1de735ef8bcbd406994e92f8719a78e581aa5bfc596b369724e49b09ada7ea7c624535ffd4bf2c9db643233ffff',
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
