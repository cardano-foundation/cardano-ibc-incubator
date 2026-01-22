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
                value: '08-cardano-24',
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
const block_results_has_client_event = {
  block_results: {
    height: { revision_height: 650879n, revision_number: 0n },
    txs_results: [
      {
        code: 0,
        events: [
          {
            type: 'update_client',
            event_attribute: [
              { key: 'client_id', value: 'ibc_client-', index: true },
              {
                key: 'consensus_height',
                value: '100970',
                index: true,
              },
              { key: 'header', value: '', index: true },
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
const block_results_has_connection_event = {
  block_results: {
    height: { revision_height: 650879n, revision_number: 0n },
    txs_results: [
      {
        code: 0,
        events: [
          {
            type: 'connection_open_init',
            event_attribute: [
              {
                key: 'connection_id',
                value: 'connection-',
                index: true,
              },
              {
                key: 'client_id',
                value: 'ibc_client-355',
                index: true,
              },
              {
                key: 'counterparty_client_id',
                value: '08-cardano-24',
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
const block_results_has_channel_event = {
  block_results: {
    height: { revision_height: 650879n, revision_number: 0n },
    txs_results: [
      {
        code: 0,
        events: [
          {
            type: 'channel_open_init',
            event_attribute: [
              {
                key: 'connection_id',
                value: 'connection-0',
                index: true,
              },
              { key: 'port_id', value: 'port-99', index: true },
              { key: 'channel_id', value: 'channel-', index: true },
              { key: 'version', value: 'ics20-1', index: true },
              {
                key: 'counterparty_channel_id',
                value: '',
                index: true,
              },
              {
                key: 'counterparty_port_id',
                value: 'bank',
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
        client_id: '08-cardano-24',
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
      client_id: '08-cardano-24',
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

const query_packet_acknowledgement_expected = {
  acknowledgement: 'aa010400000000',
  proof: 'MC02NTA4NzkvYWNrcy9kZmMzNDM2MGFjNWE2YmY4Nzc4NmE0NjhlMzc4M2M4ZTZhMDM5Yzk5ZWIxMDRkODlhZDYwYTBhODQ4ZTViYzViLzA=',
  proof_height: {
    revision_number: 0,
    revision_height: 650879,
  },
};

const query_packet_acknowledgements_expected = {
  acknowledgements: [],
  pagination: { next_key: null, total: 0 },
  height: { revision_number: 0n, revision_height: 0n },
};

const query_packet_commitment_expected = {
  commitment: '9a888e6fcbf89e9a0c461a84f448f5efb68791db772fd6426b48d34f7288b5fd',
  proof:
    'MC02NTA4NzkvY29tbWl0bWVudHMvZGZjMzQzNjBhYzVhNmJmODc3ODZhNDY4ZTM3ODNjOGU2YTAzOWM5OWViMTA0ZDg5YWQ2MGEwYTg0OGU1YmM1Yi8w',
  proof_height: {
    revision_number: 0,
    revision_height: 650879,
  },
};

const query_packet_receipt_expected = {
  received: true,
  proof:
    'MC02NTA4NzkvcmVjZWlwdHMvZGZjMzQzNjBhYzVhNmJmODc3ODZhNDY4ZTM3ODNjOGU2YTAzOWM5OWViMTA0ZDg5YWQ2MGEwYTg0OGU1YmM1Yi8w',
  proof_height: {
    revision_number: 0,
    revision_height: 650879,
  },
};

const query_proof_unreceipt_expected = {
  proof:
    'MC02NTA4NzkvcmVjZWlwdHMvZGZjMzQzNjBhYzVhNmJmODc3ODZhNDY4ZTM3ODNjOGU2YTAzOWM5OWViMTA0ZDg5YWQ2MGEwYTg0OGU1YmM1Yi8w',
  proof_height: {
    revision_number: 0,
    revision_height: 650879,
  },
};

export {
  block_results,
  block_results_has_client_event,
  block_results_has_connection_event,
  block_results_has_channel_event,
  query_connections_expected,
  query_connection_expected,
  query_channels_expected,
  query_channel_expected,
  query_packet_acknowledgement_expected,
  query_packet_acknowledgements_expected,
  query_packet_commitment_expected,
  query_packet_receipt_expected,
  query_proof_unreceipt_expected,
};
