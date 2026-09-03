import { ServerCredentials } from '@grpc/grpc-js';
import { createGrpcOptions, createGrpcServerCredentials } from './grpc-client.options';

describe('Gateway gRPC server options', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses insecure credentials when TLS files are not configured', () => {
    const insecureCredentials = {} as ServerCredentials;
    const createInsecure = jest.spyOn(ServerCredentials, 'createInsecure').mockReturnValue(insecureCredentials);

    expect(createGrpcServerCredentials({})).toBe(insecureCredentials);
    expect(createInsecure).toHaveBeenCalledTimes(1);
  });

  it('loads a certificate and private key together', () => {
    const secureCredentials = {} as ServerCredentials;
    const createSsl = jest.spyOn(ServerCredentials, 'createSsl').mockReturnValue(secureCredentials);
    const readFile = jest.fn((path: string) => Buffer.from(path));

    const credentials = createGrpcServerCredentials(
      {
        GRPC_TLS_CERT_FILE: '/run/secrets/gateway.crt',
        GRPC_TLS_KEY_FILE: '/run/secrets/gateway.key',
      },
      readFile,
    );

    expect(credentials).toBe(secureCredentials);
    expect(readFile).toHaveBeenNthCalledWith(1, '/run/secrets/gateway.crt');
    expect(readFile).toHaveBeenNthCalledWith(2, '/run/secrets/gateway.key');
    expect(createSsl).toHaveBeenCalledWith(
      null,
      [
        {
          cert_chain: Buffer.from('/run/secrets/gateway.crt'),
          private_key: Buffer.from('/run/secrets/gateway.key'),
        },
      ],
      false,
    );
  });

  it.each([[{ GRPC_TLS_CERT_FILE: '/run/secrets/gateway.crt' }], [{ GRPC_TLS_KEY_FILE: '/run/secrets/gateway.key' }]])(
    'fails closed when only one TLS file is configured',
    (env) => {
      expect(() => createGrpcServerCredentials(env)).toThrow(
        'GRPC_TLS_CERT_FILE and GRPC_TLS_KEY_FILE must be configured together',
      );
    },
  );

  it('uses the configured bind address', () => {
    const options = createGrpcOptions({ GRPC_HOST: '127.0.0.1', GRPC_PORT: '5501' });

    expect(options.options.url).toBe('127.0.0.1:5501');
  });

  it('binds a standalone Gateway to loopback by default', () => {
    const options = createGrpcOptions({});

    expect(options.options.url).toBe('127.0.0.1:5001');
  });
});
