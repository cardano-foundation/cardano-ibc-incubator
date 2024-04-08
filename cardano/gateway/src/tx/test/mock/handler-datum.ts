class HandlerDatumMockBuilder {
  private state: any;
  private token: any;

  constructor() {
    this.setDefault();
  }
  private reset(): void {
    this.setDefault();
  }
  private setDefault(): any {
    this.state = {
      next_client_sequence: 6n,
      next_connection_sequence: 6n,
      next_channel_sequence: 5n,
      bound_port: new Map([
        [99n, true],
        [100n, true],
      ]),
    };
    this.token = {
      policyId: 'b92d67b266fe85023e63d418329003e298783f487373a7f0adf59a4c',
      name: '68616e646c6572',
    };
  }
  withNextClientSequence(nextClientSequence: bigint): HandlerDatumMockBuilder {
    this.state.next_client_sequence = nextClientSequence;
    return this;
  }

  withNextConnectionSequence(nextConnectionSequence: bigint): HandlerDatumMockBuilder {
    this.state.next_connection_sequence = nextConnectionSequence;
    return this;
  }

  withNextChannelSequence(nextChannelSequence: bigint): HandlerDatumMockBuilder {
    this.state.next_channel_sequence = nextChannelSequence;
    return this;
  }

  withBoundPort(boundPort: Map<bigint, boolean>): HandlerDatumMockBuilder {
    this.state.bound_port = boundPort;
    return this;
  }

  withPolicyId(policyId: string): HandlerDatumMockBuilder {
    this.token.policyId = policyId;
    return this;
  }

  withName(name: string): HandlerDatumMockBuilder {
    this.token.name = name;
    return this;
  }

  build(): any {
    const builtHandlerDatum = {
      state: { ...this.state },
      token: { ...this.token },
    };
    this.reset();
    return builtHandlerDatum;
  }
}

const handlerDatumMockBuilder = new HandlerDatumMockBuilder();

export default handlerDatumMockBuilder;
