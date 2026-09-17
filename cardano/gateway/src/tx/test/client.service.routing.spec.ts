import { ClientService } from '../client.service';
import type { LightClientHandler } from '../light-client-handler';

function handler(clientType: string): LightClientHandler {
  return {
    clientType,
    clientStateTypeUrl: `/${clientType}.ClientState`,
    consensusStateTypeUrl: `/${clientType}.ConsensusState`,
    clientMessageTypeUrls: [`/${clientType}.Header`, `/${clientType}.Misbehaviour`],
    service: {
      createClient: jest.fn(async () => ({ client_id: `${clientType}-0` })),
      updateClient: jest.fn(async () => ({})),
      recoverClient: jest.fn(async () => ({})),
    },
  };
}

const any = (type_url: string) => ({ type_url, value: new Uint8Array([1, 2, 3]) });

describe('light-client request routing', () => {
  const first = handler('07-tendermint');
  const second = handler('99-test-client');
  const router = new ClientService([first, second]);

  beforeEach(() => jest.clearAllMocks());

  it.each([first, second])('routes creation using the registered client-state type: $clientType', async (client) => {
    const request = {
      client_state: any(client.clientStateTypeUrl),
      consensus_state: any(client.consensusStateTypeUrl),
      signer: 'signer',
    };
    await expect(router.createClient(request)).resolves.toEqual({ client_id: `${client.clientType}-0` });
    expect(client.service.createClient).toHaveBeenCalledWith(request);
  });

  it('rejects a consensus state from another client type before decoding', async () => {
    await expect(
      router.createClient({
        client_state: any(first.clientStateTypeUrl),
        consensus_state: any(second.consensusStateTypeUrl),
        signer: 'signer',
      }),
    ).rejects.toThrow('Consensus state type does not match');
    expect(first.service.createClient).not.toHaveBeenCalled();
    expect(second.service.createClient).not.toHaveBeenCalled();
  });

  it('rejects unregistered and empty protobuf type URLs', async () => {
    for (const type of ['', '/unknown.ClientState']) {
      await expect(
        router.createClient({
          client_state: any(type),
          consensus_state: any(first.consensusStateTypeUrl),
          signer: 'signer',
        }),
      ).rejects.toThrow('Unsupported client state type');
    }
    expect(first.service.createClient).not.toHaveBeenCalled();
  });

  it('routes independent instances of each type without conflating their sequences', async () => {
    for (const client of [first, second]) {
      for (const sequence of ['0', '1', '18446744073709551615']) {
        const request = {
          client_id: `${client.clientType}-${sequence}`,
          client_message: any(client.clientMessageTypeUrls[0]),
          signer: 'signer',
        };
        await router.updateClient(request);
        expect(client.service.updateClient).toHaveBeenLastCalledWith(request);
      }
      expect(client.service.updateClient).toHaveBeenCalledTimes(3);
    }
  });

  it('rejects message types that do not belong to the selected client', async () => {
    await expect(
      router.updateClient({
        client_id: `${first.clientType}-0`,
        client_message: any(second.clientMessageTypeUrls[0]),
        signer: 'signer',
      }),
    ).rejects.toThrow('Unsupported client message');
    expect(first.service.updateClient).not.toHaveBeenCalled();
  });

  it.each(['07-tendermint-01', '07-tendermint--1', '07-tendermint-1x', 'unregistered-0'])(
    'rejects invalid IDs: %s',
    async (client_id) => {
      await expect(
        router.updateClient({ client_id, client_message: any(first.clientMessageTypeUrls[0]), signer: 'signer' }),
      ).rejects.toThrow('Invalid or unsupported client ID');
    },
  );

  it('routes recovery within one type and rejects recovery across types', async () => {
    const request = {
      subject_client_id: `${second.clientType}-0`,
      substitute_client_id: `${second.clientType}-1`,
      signer: 'signer',
    };
    await router.recoverClient(request);
    expect(second.service.recoverClient).toHaveBeenCalledWith(request);
    await expect(router.recoverClient({ ...request, substitute_client_id: `${first.clientType}-1` })).rejects.toThrow(
      'Recovery clients must use the same client type',
    );
    expect(second.service.recoverClient).toHaveBeenCalledTimes(1);
  });

  it('rejects ambiguous handler registrations', () => {
    expect(() => new ClientService([first, first])).toThrow('Duplicate light-client handler');
    expect(() => new ClientService([first, { ...second, clientStateTypeUrl: first.clientStateTypeUrl }])).toThrow(
      'Duplicate light-client handler',
    );
  });

  it.each([7, 55])('accepts a client type with %i characters', (length) => {
    expect(() => new ClientService([handler('a'.repeat(length))])).not.toThrow();
  });

  it.each([6, 56])('rejects a client type with %i characters that cannot cover the IBC ID range', (length) => {
    expect(() => new ClientService([handler('a'.repeat(length))])).toThrow('Invalid light-client handler registration');
  });
});
