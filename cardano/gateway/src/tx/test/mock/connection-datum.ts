class ConnectionDatumMockBuilder {
  private connectionDatum: {
    state: {
      client_id: string;
      versions: { identifier: string; features: string[] }[];
      state: string;
      counterparty: {
        client_id: string;
        connection_id: string;
        prefix: { key_prefix: string };
      };
      delay_period: bigint;
    };
    token: {
      policyId: string;
      name: string;
    };
  };

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.connectionDatum = {
      state: {
        client_id: '6962635f636c69656e742d333535',
        versions: [
          {
            identifier: '31',
            features: ['4f524445525f4f524445524544', '4f524445525f554e4f524445524544'],
          },
        ],
        state: 'Init',
        counterparty: {
          client_id: '3039392d63617264616e6f2d3234',
          connection_id: '',
          prefix: { key_prefix: '696263' },
        },
        delay_period: 0n,
      },
      token: {
        policyId: '8a893f54dc9fda44a2ee3e1590f375ce31106b16ff9b017302b66fff',
        name: '94051031ba171ddc7783efe491f76b4d2f1ba64019dd9b30323535',
      },
    };
  }

  reset(): void {
    this.setDefault();
  }

  withClientId(clientId: string): ConnectionDatumMockBuilder {
    this.connectionDatum.state.client_id = clientId;
    return this;
  }

  withVersions(versions: { identifier: string; features: string[] }[]): ConnectionDatumMockBuilder {
    this.connectionDatum.state.versions = versions;
    return this;
  }

  withState(state: string): ConnectionDatumMockBuilder {
    this.connectionDatum.state.state = state;
    return this;
  }

  withCounterpartyClientId(counterpartyClientId: string): ConnectionDatumMockBuilder {
    this.connectionDatum.state.counterparty.client_id = counterpartyClientId;
    return this;
  }

  withCounterpartyConnectionId(connectionId: string): ConnectionDatumMockBuilder {
    this.connectionDatum.state.counterparty.connection_id = connectionId;
    return this;
  }

  withCounterpartyPrefixKeyPrefix(keyPrefix: string): ConnectionDatumMockBuilder {
    this.connectionDatum.state.counterparty.prefix.key_prefix = keyPrefix;
    return this;
  }

  withDelayPeriod(delayPeriod: bigint): ConnectionDatumMockBuilder {
    this.connectionDatum.state.delay_period = delayPeriod;
    return this;
  }

  withTokenPolicyId(policyId: string): ConnectionDatumMockBuilder {
    this.connectionDatum.token.policyId = policyId;
    return this;
  }

  withTokenName(name: string): ConnectionDatumMockBuilder {
    this.connectionDatum.token.name = name;
    return this;
  }

  build(): any {
    const builtConnectionDatum = { ...this.connectionDatum };
    this.reset();
    return builtConnectionDatum;
  }
}

const connectionDatumMockBuilder = new ConnectionDatumMockBuilder();

export default connectionDatumMockBuilder;
