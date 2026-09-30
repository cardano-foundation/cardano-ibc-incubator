import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

export function historicalReadOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.GATEWAY_HISTORICAL_READ_ONLY;
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('GATEWAY_HISTORICAL_READ_ONLY must be true or false');
}

/** Recovery mode exposes authenticated historical queries, never transaction RPCs. */
@Injectable()
export class HistoricalReadOnlyGuard implements CanActivate {
  private readonly readOnly = historicalReadOnly();
  canActivate(context?: ExecutionContext): boolean {
    const message = 'Gateway is in historical read-only mode; install the verified active manifest and restart in normal mode to submit bridge operations';
    if (this.readOnly && context?.getType() === 'http') throw new ServiceUnavailableException(message);
    if (this.readOnly) throw new RpcException({
      code: status.FAILED_PRECONDITION,
      message,
    });
    return true;
  }
}
