import { EventEmitter } from 'events';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { HandshakeAcceptVersion, VersionData } from '@harmoniclabs/ouroboros-miniprotocols-ts';
import { HistoryService } from '../../../query/services/history.service';
import { MiniProtocalsService } from './mini-protocals.service';

const mockPropose = jest.fn();
const mockRequest = jest.fn();
const mockTerminate = jest.fn();
let mockTransport: EventEmitter & { close: jest.Mock };
let mockSocket: EventEmitter & { destroy: jest.Mock };
let mockHandshake: EventEmitter;
let mockBlockFetch: EventEmitter;

jest.mock('net', () => ({
  ...jest.requireActual('net'),
  createConnection: jest.fn().mockImplementation(() => {
    const { EventEmitter: Emitter } = jest.requireActual('events');
    mockSocket = Object.assign(new Emitter(), { destroy: jest.fn() });
    return mockSocket;
  }),
}));

jest.mock('@harmoniclabs/ouroboros-miniprotocols-ts', () => ({
  ...jest.requireActual('@harmoniclabs/ouroboros-miniprotocols-ts'),
  Multiplexer: jest.fn().mockImplementation(({ connect }) => {
    const { EventEmitter: Emitter } = jest.requireActual('events');
    mockTransport = Object.assign(new Emitter(), { close: jest.fn() });
    connect();
    return mockTransport;
  }),
  HandshakeClient: jest.fn().mockImplementation(() => {
    const { EventEmitter: Emitter } = jest.requireActual('events');
    mockHandshake = Object.assign(new Emitter(), { propose: mockPropose, terminate: mockTerminate });
    return mockHandshake;
  }),
  BlockFetchClient: jest.fn().mockImplementation(() => {
    const { EventEmitter: Emitter } = jest.requireActual('events');
    mockBlockFetch = Object.assign(new Emitter(), { request: mockRequest });
    return mockBlockFetch;
  }),
}));

describe('Cardano block witness transport', () => {
  const block = { hash: 'ab'.repeat(32), slotNo: 123n };
  let service: MiniProtocalsService;

  beforeEach(() => {
    jest.clearAllMocks();
    const settings: Record<string, string | number> = { cardanoChainHost: '127.0.0.1', cardanoChainPort: 3001, cardanoChainNetworkMagic: 42 };
    service = new MiniProtocalsService(
      {} as HistoryService,
      { get: (key: string) => settings[key] } as ConfigService,
      { error: jest.fn(), warn: jest.fn() } as unknown as Logger,
    );
    mockPropose.mockResolvedValue(new HandshakeAcceptVersion({
      versionNumber: 13, versionData: new VersionData({ networkMagic: 42, query: false }),
    }, true));
    mockRequest.mockResolvedValue({ getBlockBytes: () => Buffer.from('abcd', 'hex') });
  });

  afterEach(() => jest.useRealTimers());

  it('establishes an accepted session rather than only querying supported versions', async () => {
    await expect(service.fetchBlockCbor(block)).resolves.toEqual(Buffer.from('abcd', 'hex'));
    expect(mockPropose).toHaveBeenCalledWith({ networkMagic: 42, query: false });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockTerminate).toHaveBeenCalledTimes(1);
    expect(mockTransport.close).toHaveBeenCalledTimes(1);
    expect(mockSocket.destroy).toHaveBeenCalledTimes(1);
    expect(mockTransport.listenerCount('error')).toBe(0);
  });

  it('normalizes the era envelope returned by an actual node', async () => {
    mockRequest.mockResolvedValue({ getBlockBytes: () => Buffer.from('820785808080a080', 'hex') });
    await expect(service.fetchBlockCbor(block)).resolves.toEqual(Buffer.from('85808080a080', 'hex'));
  });

  it('rejects a query reply or refusal without attempting block fetch', async () => {
    mockPropose.mockResolvedValue({ versionTable: {} });
    await expect(service.fetchBlockCbor(block)).rejects.toThrow('did not accept');
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockTransport.close).toHaveBeenCalledTimes(1);
  });

  it.each([{ networkMagic: 1, query: false }, { networkMagic: 42, query: true }])(
    'rejects an accepted response with incompatible session parameters: %j', async parameters => {
      mockPropose.mockResolvedValue(new HandshakeAcceptVersion({
        versionNumber: 13, versionData: new VersionData(parameters),
      }, true));
      await expect(service.fetchBlockCbor(block)).rejects.toThrow('did not accept');
      expect(mockRequest).not.toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['handshake', 'block fetch'])('closes a silent %s after its bounded deadline', async stage => {
    jest.useFakeTimers();
    (stage === 'handshake' ? mockPropose : mockRequest).mockImplementation(() => new Promise(() => undefined));
    const pending = expect(service.fetchBlockCbor(block)).rejects.toThrow('transport timed out');
    await jest.advanceTimersByTimeAsync(30_001);
    await pending;
    expect(mockTransport.close).toHaveBeenCalledTimes(1);
    expect(mockTransport.listenerCount('error')).toBe(0);
    expect(mockSocket.destroy).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['handshake', 'block fetch'])('rejects %s client errors without an uncaught event', async stage => {
    jest.useFakeTimers();
    const operation = stage === 'handshake' ? mockPropose : mockRequest;
    operation.mockImplementation(() => new Promise(() => {
      queueMicrotask(() => (stage === 'handshake' ? mockHandshake : mockBlockFetch).emit('error', new Error('invalid protocol payload')));
    }));
    const pending = expect(service.fetchBlockCbor(block)).rejects.toThrow('invalid protocol payload');
    await jest.advanceTimersByTimeAsync(1);
    await pending;
    expect(mockSocket.destroy).toHaveBeenCalledTimes(1);
    expect(mockHandshake.listenerCount('error')).toBe(0);
    expect(mockBlockFetch.listenerCount('error')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('closes the connection and clears its deadline on synchronous transport failure', async () => {
    jest.useFakeTimers();
    mockPropose.mockImplementation(() => { throw new Error('invalid transport state'); });
    await expect(service.fetchBlockCbor(block)).rejects.toThrow('invalid transport state');
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockTransport.close).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
