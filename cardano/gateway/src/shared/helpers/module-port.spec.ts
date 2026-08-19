import { isSupportedGatewayPortId } from './module-port';

describe('module port routing', () => {
  it.each(['transfer', 'mock', 'icqhost'])('accepts the exact registered port %s', (portId) => {
    expect(isSupportedGatewayPortId(portId)).toBe(true);
  });

  it.each(['Transfer', ' transfer', 'transfer ', 'port-99', 'port-100', 'port-101'])(
    'rejects the unregistered alias %s',
    (portId) => {
      expect(isSupportedGatewayPortId(portId)).toBe(false);
    },
  );
});
