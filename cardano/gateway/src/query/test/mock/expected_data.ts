const block_results = {
  block_results: {
    height: { revision_height: 650879n, revision_number: 0n },
    txs_results: [
      {
        code: 0,
        events: [
          {
            type: 'connection_open_init',
            event_attribute: [
              { key: 'connection_id', value: 'connection-255', index: true },
              {
                key: 'client_id',
                value: 'ibc_client-355',
                index: true,
              },
              {
                key: 'counterparty_client_id',
                value: '099-cardano-24',
                index: true,
              },
              {
                key: 'counterparty_connection_id',
                value: '',
                index: true,
              },
            ],
          },
        ],
      },
      {
        code: 0,
        events: [{ type: 'register', event_attribute: [] }],
      },
      {
        code: 0,
        events: [{ type: 'unregister', event_attribute: [] }],
      },
    ],
  },
};

const query_connections_expected = {
  connections: [
    {
      id: 'connection-255',
      client_id: 'ibc_client-355',
      versions: [
        {
          identifier: '1',
          features: ['ORDER_ORDERED', 'ORDER_UNORDERED'],
        },
      ],
      state: 1,
      counterparty: {
        client_id: '099-cardano-24',
        connection_id: '',
        prefix: { key_prefix: '696263' },
      },
      delay_period: 0n,
    },
  ],
  pagination: { next_key: null, total: 0 },
  height: { revision_number: 0n, revision_height: 0n },
};

const query_connection_expected = {
  connection: {
    client_id: 'ibc_client-355',
    versions: [
      {
        identifier: '1',
        features: ['ORDER_ORDERED', 'ORDER_UNORDERED'],
      },
    ],
    state: 1,
    counterparty: {
      client_id: '099-cardano-24',
      connection_id: '',
      prefix: { key_prefix: '696263' },
    },
    delay_period: 0n,
  },
  proof:
    'MC02NTA4NzkvY29ubmVjdGlvbi9kZmMzNDM2MGFjNWE2YmY4Nzc4NmE0NjhlMzc4M2M4ZTZhMDM5Yzk5ZWIxMDRkODlhZDYwYTBhODQ4ZTViYzViLzA=',
  proof_height: {
    revision_number: 0,
    revision_height: 650879,
  },
};

const query_channels_expected = {
  channels: [
    {
      state: 1,
      ordering: 1,
      counterparty: { port_id: 'bank', channel_id: '' },
      connection_hops: ['connection-0'],
      version: 'ics20-1',
      port_id: 'port-99',
      channel_id: 'channel-',
    },
  ],
  pagination: { next_key: null, total: 0 },
  height: { revision_number: 0n, revision_height: 0n },
};

const query_channel_expected = {
  channel: {
    state: 1,
    ordering: 1,
    counterparty: { port_id: 'bank', channel_id: '' },
    connection_hops: ['connection-0'],
    version: 'ics20-1',
  },
  proof:
    'MC02NTA4NzkvY2hhbm5lbC9kZmMzNDM2MGFjNWE2YmY4Nzc4NmE0NjhlMzc4M2M4ZTZhMDM5Yzk5ZWIxMDRkODlhZDYwYTBhODQ4ZTViYzViLzA=',
  proof_height: { revision_number: 0, revision_height: 650879 },
};

export {
  block_results,
  query_connections_expected,
  query_connection_expected,
  query_channels_expected,
  query_channel_expected,
};
