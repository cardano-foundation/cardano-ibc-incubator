import { ExecutionContext } from '@nestjs/common';
import { Metadata, status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { GrpcAuthGuard, loadGrpcAuthToken } from './grpc-auth.guard';

function grpcContext(metadata: Metadata): ExecutionContext {
  return {
    switchToRpc: () => ({
      getContext: () => metadata,
    }),
  } as ExecutionContext;
}

describe('GrpcAuthGuard', () => {
  it('leaves local backwards-compatible operation unauthenticated when no token is configured', () => {
    const guard = new GrpcAuthGuard(undefined);

    expect(guard.canActivate(grpcContext(new Metadata()))).toBe(true);
  });

  it('accepts exactly one matching bearer token', () => {
    const metadata = new Metadata();
    metadata.add('authorization', 'Bearer test-secret');
    const guard = new GrpcAuthGuard('test-secret');

    expect(guard.canActivate(grpcContext(metadata))).toBe(true);
  });

  it.each([
    { values: [] },
    { values: ['Bearer wrong-secret'] },
    { values: ['Basic test-secret'] },
    { values: ['Bearer test-secret', 'Bearer test-secret'] },
  ])('rejects missing, incorrect, or repeated authorization metadata', ({ values }) => {
    const metadata = new Metadata();
    values.forEach((value) => metadata.add('authorization', value));
    const guard = new GrpcAuthGuard('test-secret');

    try {
      guard.canActivate(grpcContext(metadata));
      throw new Error('expected authentication to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(RpcException);
      expect((error as RpcException).getError()).toEqual({
        code: status.UNAUTHENTICATED,
        message: 'Gateway authentication failed',
      });
    }
  });
});

describe('loadGrpcAuthToken', () => {
  it('is optional and trims a configured token file', () => {
    expect(loadGrpcAuthToken({})).toBeUndefined();
    const readFile = jest.fn(() => '  test-secret\n');

    expect(loadGrpcAuthToken({ GRPC_AUTH_TOKEN_FILE: '/run/secrets/gateway-token' }, readFile)).toBe('test-secret');
    expect(readFile).toHaveBeenCalledWith('/run/secrets/gateway-token', 'utf8');
  });

  it('rejects an empty configured token file', () => {
    expect(() => loadGrpcAuthToken({ GRPC_AUTH_TOKEN_FILE: '/tmp/token' }, () => ' \n')).toThrow(
      'GRPC_AUTH_TOKEN_FILE must contain a non-empty token',
    );
  });
});
