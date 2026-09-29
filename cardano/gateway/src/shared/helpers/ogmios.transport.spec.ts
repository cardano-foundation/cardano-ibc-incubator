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
