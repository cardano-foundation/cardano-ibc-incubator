import { resolveManagedKupmiosHeaders, resolveManagedOgmiosHttpEndpoint } from './managed-cardano-endpoints';

describe('managed Cardano endpoints', () => {
  it('uses Demeter authenticated Ogmios host for HTTP JSON-RPC', () => {
    expect(resolveManagedOgmiosHttpEndpoint('https://cardano-preprod-v6.ogmios-m1.dmtr.host', 'ogmios123')).toBe(
      'https://ogmios123.cardano-preprod-v6.ogmios-m1.dmtr.host',
    );
  });

  it('does not send Ogmios auth header to authenticated Demeter host', () => {
    expect(
      resolveManagedKupmiosHeaders(
        'https://cardano-preprod-v2.kupo-m1.dmtr.host',
        'kupo123',
        'https://ogmios123.cardano-preprod-v6.ogmios-m1.dmtr.host',
        'ogmios123',
      ),
    ).toEqual({ kupoHeader: { 'dmtr-api-key': 'kupo123' } });
  });
});
