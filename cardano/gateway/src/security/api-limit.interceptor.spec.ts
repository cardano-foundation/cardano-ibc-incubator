import { CallHandler, Controller, ExecutionContext, Get, HttpException, INestApplication } from '@nestjs/common';
import { Client, credentials, status } from '@grpc/grpc-js';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { firstValueFrom, from, of, throwError } from 'rxjs';
import request from 'supertest';
import { createGrpcOptions } from '../grpc-client.options';
import { ApiLimitInterceptor } from './api-limit.interceptor';

const httpContext = { getType: () => 'http' } as ExecutionContext;
const rpcContext = { getType: () => 'rpc' } as ExecutionContext;

describe('ApiLimitInterceptor', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['GATEWAY_API_RATE_LIMIT', 'GATEWAY_API_MAX_CONCURRENT'])(
    'rejects invalid %s configuration instead of disabling protection',
    (name) => {
      for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', 'invalid', '9007199254740992']) {
        expect(() => new ApiLimitInterceptor({ [name]: value })).toThrow(`${name} must be a positive integer`);
      }
    },
  );

  it('limits bursts and refills gradually without accumulating more than one second of allowance', async () => {
    const clock = jest.spyOn(performance, 'now').mockReturnValue(0);
    const limiter = new ApiLimitInterceptor({ GATEWAY_API_RATE_LIMIT: '2' });
    const handler = { handle: jest.fn(() => of('done')) };
    const run = () => firstValueFrom(limiter.intercept(httpContext, handler));

    await run();
    await run();
    await expect(run()).rejects.toBeInstanceOf(HttpException);
    clock.mockReturnValue(499);
    await expect(run()).rejects.toBeInstanceOf(HttpException);
    clock.mockReturnValue(500);
    await expect(run()).resolves.toBe('done');
    clock.mockReturnValue(10_000);
    await run();
    await run();
    await expect(run()).rejects.toBeInstanceOf(HttpException);
    expect(handler.handle).toHaveBeenCalledTimes(5);
  });

  it.each([
    { handle: () => throwError(() => new Error('upstream failed')) },
    {
      handle: () => {
        throw new Error('upstream failed');
      },
    },
  ])('releases the concurrency slot on handler failure', async (handler: CallHandler) => {
    const limiter = new ApiLimitInterceptor({ GATEWAY_API_MAX_CONCURRENT: '1' });
    await expect(firstValueFrom(limiter.intercept(rpcContext, handler))).rejects.toThrow('upstream failed');
    await expect(firstValueFrom(limiter.intercept(rpcContext, { handle: () => of('done') }))).resolves.toBe('done');
  });

  it('keeps cancelled work counted until its underlying promise settles', async () => {
    const limiter = new ApiLimitInterceptor({ GATEWAY_API_MAX_CONCURRENT: '1' });
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const subscription = limiter.intercept(rpcContext, { handle: () => from(work) }).subscribe();
    subscription.unsubscribe();
    const next = { handle: jest.fn(() => of('done')) };
    await expect(firstValueFrom(limiter.intercept(rpcContext, next))).rejects.toBeInstanceOf(RpcException);
    expect(next.handle).not.toHaveBeenCalled();

    finish();
    await work;
    await expect(firstValueFrom(limiter.intercept(rpcContext, next))).resolves.toBe('done');
  });
});

@Controller()
class WorkController {
  work = jest.fn(async () => ({ height: 42 }));

  @Get('work')
  @GrpcMethod('Query', 'LatestHeight')
  execute() {
    return this.work();
  }
}

describe('shared HTTP and gRPC request limits', () => {
  let app: INestApplication;
  let client: Client;
  let controller: WorkController;
  let socketDirectory: string;
  let finish: () => void;

  beforeEach(async () => {
    // A fixed monotonic clock makes rate tests independent of network timing.
    jest.spyOn(performance, 'now').mockReturnValue(0);
    const module = await Test.createTestingModule({ controllers: [WorkController] }).compile();
    app = module.createNestApplication({ logger: false });
    controller = module.get(WorkController);
    app.useGlobalInterceptors(
      new ApiLimitInterceptor({ GATEWAY_API_RATE_LIMIT: '2', GATEWAY_API_MAX_CONCURRENT: '1' }),
    );
    socketDirectory = mkdtempSync(join(tmpdir(), 'gw-'));
    const options = createGrpcOptions({});
    options.options.url = `unix:${join(socketDirectory, 'api.sock')}`;
    app.connectMicroservice(options, { inheritAppConfig: true });
    await app.startAllMicroservices();
    await app.init();
    client = new Client(options.options.url, credentials.createInsecure());
    finish = () => {};
  });

  afterEach(async () => {
    finish?.();
    client?.close();
    await app?.close();
    if (socketDirectory) rmSync(socketDirectory, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  function rpc() {
    let call!: ReturnType<Client['makeUnaryRequest']>;
    const response = new Promise<Buffer>((resolve, reject) => {
      call = client.makeUnaryRequest(
        '/ibc.core.client.v1.Query/LatestHeight',
        () => Buffer.alloc(0),
        (buffer) => buffer,
        {},
        (error, value) => (error ? reject(error) : resolve(value!)),
      );
    });
    return { call, response };
  }

  function holdWork(): Promise<void> {
    const work = new Promise<{ height: number }>((resolve) => {
      finish = () => resolve({ height: 42 });
    });
    return new Promise<void>((started) => {
      controller.work.mockImplementationOnce(() => {
        started();
        return work;
      });
    });
  }

  it('shares a rate budget across HTTP and gRPC and returns transport-specific errors', async () => {
    await request(app.getHttpServer()).get('/work').expect(200);
    await expect(rpc().response).resolves.toEqual(Buffer.from([8, 42]));
    await request(app.getHttpServer()).get('/work').expect(429);
    await expect(rpc().response).rejects.toMatchObject({ code: status.RESOURCE_EXHAUSTED });
    expect(controller.work).toHaveBeenCalledTimes(2);
  });

  it('rejects both transports while an HTTP handler is running and recovers after completion', async () => {
    const started = holdWork();
    const pending = request(app.getHttpServer())
      .get('/work')
      .then((response) => response.status);
    await started;
    await expect(rpc().response).rejects.toMatchObject({ code: status.RESOURCE_EXHAUSTED });
    await request(app.getHttpServer()).get('/work').expect(429);
    expect(controller.work).toHaveBeenCalledTimes(1);
    finish();
    await expect(pending).resolves.toBe(200);
    await expect(rpc().response).resolves.toEqual(Buffer.from([8, 42]));
  });

  it('does not admit more HTTP work when a busy gRPC caller disconnects', async () => {
    const started = holdWork();
    const pending = rpc();
    const cancelled = expect(pending.response).rejects.toMatchObject({ code: status.CANCELLED });
    await started;
    pending.call.cancel();
    await cancelled;
    await request(app.getHttpServer()).get('/work').expect(429);
    expect(controller.work).toHaveBeenCalledTimes(1);
    finish();
    await request(app.getHttpServer()).get('/work').expect(200);
  });
});
