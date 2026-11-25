import { createServer, Server, Socket } from 'node:net';

describe('Ogmios connection timeout with a real WebSocket transport', () => {
  let server: Server;
  const sockets = new Set<Socket>();
  const previousTimeout = process.env.OGMIOS_OPEN_TIMEOUT_MS;

  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousTimeout === undefined) delete process.env.OGMIOS_OPEN_TIMEOUT_MS;
    else process.env.OGMIOS_OPEN_TIMEOUT_MS = previousTimeout;
    jest.resetModules();
  });

  it('rejects a stalled handshake and closes it without an unhandled cleanup error', async () => {
    process.env.OGMIOS_OPEN_TIMEOUT_MS = '100';
    jest.resetModules();
    const { queryOperationalCertificateCountersAtPoint } = await import('./ogmios');
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on('data', () => undefined); // Accept TCP, deliberately never upgrade HTTP.
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing bound TCP port');
    await expect(queryOperationalCertificateCountersAtPoint(
      `ws://127.0.0.1:${address.port}`, { slot: 1n, hash: '11'.repeat(32) },
    )).rejects.toThrow('Ogmios WebSocket connection timed out after 100ms');
    expect(sockets.size).toBe(1);
    // ws emits its termination error asynchronously after rejection. Waiting
    // for the real peer close catches the process-crash regression as well.
    for (const socket of sockets) {
      if (!socket.destroyed) await new Promise<void>((resolve) => socket.once('close', resolve));
      expect(socket.destroyed).toBe(true);
    }
  });
});


describe('Ogmios ledger quantities over WebSocket', () => {
  it('preserves large numeric token quantities without rounding', async () => {
    const { WebSocketServer } = await import('ws');
    const { queryLedgerStateUtxosAtAddresses } = await import('./ogmios-utxo');
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing bound WebSocket port');
    const policy = 'ab'.repeat(28);
    server.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const request = JSON.parse(raw.toString());
        socket.send(`{"jsonrpc":"2.0","id":${JSON.stringify(request.id)},"result":[{"transaction":{"id":"${'cd'.repeat(32)}"},"index":2,"address":"addr_test1wallet","value":{"ada":{"lovelace":3000000},"${policy}":{"0102":1000000000000000001}},"datum":"d87980"}]}`);
      });
    });
    try {
      await expect(queryLedgerStateUtxosAtAddresses(`ws://127.0.0.1:${address.port}`, ['addr_test1wallet']))
        .resolves.toEqual([{
          txHash: 'cd'.repeat(32), outputIndex: 2, address: 'addr_test1wallet',
          assets: { lovelace: 3000000n, [policy + '0102']: 1000000000000000001n },
          datum: 'd87980',
        }]);
    } finally {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
