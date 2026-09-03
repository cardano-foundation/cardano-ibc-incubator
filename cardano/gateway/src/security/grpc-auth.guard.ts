import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { Metadata, status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { createHash, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';

export const GRPC_AUTH_TOKEN = Symbol('GRPC_AUTH_TOKEN');

type ReadFile = (path: string, encoding: BufferEncoding) => string;

export function loadGrpcAuthToken(
  env: NodeJS.ProcessEnv = process.env,
  readFile: ReadFile = (path, encoding) => readFileSync(path, encoding),
): string | undefined {
  const tokenFile = env.GRPC_AUTH_TOKEN_FILE?.trim();
  if (!tokenFile) {
    return undefined;
  }

  const token = readFile(tokenFile, 'utf8').trim();
  if (!token) {
    throw new Error('GRPC_AUTH_TOKEN_FILE must contain a non-empty token');
  }
  return token;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class GrpcAuthGuard implements CanActivate {
  private readonly expectedAuthorizationDigest?: Buffer;

  constructor(@Optional() @Inject(GRPC_AUTH_TOKEN) token: string | undefined) {
    const configuredToken = token ?? loadGrpcAuthToken();
    this.expectedAuthorizationDigest = configuredToken ? digest(`Bearer ${configuredToken}`) : undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.expectedAuthorizationDigest) {
      return true;
    }

    const metadata = context.switchToRpc().getContext<Metadata>();
    const authorizationValues = metadata?.get('authorization') ?? [];
    const authorization = authorizationValues.length === 1 ? authorizationValues[0] : undefined;
    const authorized =
      typeof authorization === 'string' && timingSafeEqual(digest(authorization), this.expectedAuthorizationDigest);

    if (!authorized) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Gateway authentication failed',
      });
    }

    return true;
  }
}
