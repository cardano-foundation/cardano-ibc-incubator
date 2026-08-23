import { readFileSync } from 'fs';
import { resolve } from 'path';

import * as Lucid from '@lucid-evolution/lucid';

import { decodeHostStateDatum, encodeHostStateDatum, HostStateDatum } from './host-state-datum';

const INJECTIVE_COMPATIBILITY_FIXTURE = readFileSync(
  resolve(__dirname, '../../../../../tests/injective-light-client-compat/host_state_datum.hex'),
  'utf8',
).trim();

describe('HostState datum Injective compatibility', () => {
  it('keeps the deployed light-client wire fields stable while carrying the textual port registry', async () => {
    const datum: HostStateDatum = {
      state: {
        version: 1n,
        ibc_state_root: '42'.repeat(32),
        next_client_sequence: 2n,
        next_connection_sequence: 3n,
        next_channel_sequence: 4n,
        bound_port: [],
        last_update_time: 7n,
      },
      nft_policy: '24'.repeat(28),
      deployer: '17'.repeat(28),
      control: {
        port_registry: new Map([
          [
            Buffer.from('transfer').toString('hex'),
            {
              module_script_hash: '11'.repeat(28),
              port_token: { policy_id: '22'.repeat(28), name: '01' },
              module_token: { policy_id: '33'.repeat(28), name: '02' },
            },
          ],
        ]),
        shutdown: 'Active',
      },
    };

    const encoded = await encodeHostStateDatum(datum, Lucid);

    expect(encoded).toBe(INJECTIVE_COMPATIBILITY_FIXTURE);
    await expect(decodeHostStateDatum(encoded, Lucid)).resolves.toEqual(datum);
  });
});
