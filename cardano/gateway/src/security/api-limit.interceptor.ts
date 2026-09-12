import { CallHandler, ExecutionContext, HttpException, HttpStatus, NestInterceptor } from '@nestjs/common';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { defer, finalize, Observable, shareReplay } from 'rxjs';

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = env[name]?.trim();
  const limit = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return limit;
}

export class ApiLimitInterceptor implements NestInterceptor {
  private readonly rate: number;
  private readonly maxConcurrent: number;
  private tokens: number;
  private refilledAt = performance.now();
  private active = 0;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.rate = positiveInteger(env, 'GATEWAY_API_RATE_LIMIT', 100);
    this.maxConcurrent = positiveInteger(env, 'GATEWAY_API_MAX_CONCURRENT', 8);
    this.tokens = this.rate;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return defer(() => {
      const now = performance.now();
      this.tokens = Math.min(this.rate, this.tokens + ((now - this.refilledAt) * this.rate) / 1000);
      this.refilledAt = now;

      if (this.tokens < 1 || this.active >= this.maxConcurrent) {
        const message = 'Gateway request limit exceeded';
        if (context.getType() === 'http') {
          throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
        }
        throw new RpcException({ code: status.RESOURCE_EXHAUSTED, message });
      }

      this.tokens -= 1;
      this.active += 1;
      return defer(() => next.handle()).pipe(finalize(() => this.active--));
    }).pipe(
      // Disconnecting does not cancel the handlers' underlying promises. Keep their
      // slots occupied until the work settles, even if the caller unsubscribes.
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }
}
