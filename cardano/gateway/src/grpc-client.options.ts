import { ServerCredentials } from '@grpc/grpc-js';
import { GrpcOptions, Transport } from '@nestjs/microservices';
import { readFileSync } from 'fs';
import { join } from 'path';

type ReadFile = (path: string) => Buffer;

export function createGrpcServerCredentials(
  env: NodeJS.ProcessEnv = process.env,
  readFile: ReadFile = (path) => readFileSync(path),
): ServerCredentials {
  const certificateFile = env.GRPC_TLS_CERT_FILE?.trim();
  const privateKeyFile = env.GRPC_TLS_KEY_FILE?.trim();

  if (Boolean(certificateFile) !== Boolean(privateKeyFile)) {
    throw new Error('GRPC_TLS_CERT_FILE and GRPC_TLS_KEY_FILE must be configured together');
  }

  if (!certificateFile || !privateKeyFile) {
    return ServerCredentials.createInsecure();
  }

  return ServerCredentials.createSsl(
    null,
    [
      {
        cert_chain: readFile(certificateFile),
        private_key: readFile(privateKeyFile),
      },
    ],
    false,
  );
}

export function createGrpcOptions(env: NodeJS.ProcessEnv = process.env): GrpcOptions {
  return {
    transport: Transport.GRPC,
    options: {
      // Standalone plaintext development is loopback-only. Docker explicitly overrides
      // this bind address while keeping the published host port on loopback.
      url: `${env.GRPC_HOST || '127.0.0.1'}:${env.GRPC_PORT || '5001'}`,
      package: [
        'ibc.core.client.v1',
        'ibc.core.types.v1',
        'ibc.core.connection.v1',
        'ibc.core.channel.v1',
        'ibc.applications.transfer.v1',
        'ibc.cardano.v1',
      ],
      protoPath: [
        join(__dirname, '../../../proto-types/protos/ibc-go/ibc/core/client/v1/tx.proto'),
        join(__dirname, '../../../proto-types/protos/ibc-go/ibc/core/client/v1/query.proto'),
        join(__dirname, '../../../proto-types/protos/ibc-go/ibc/core/types/v1/query.proto'),
        join(__dirname, '../../../proto-types/protos/ibc-go/ibc/core/connection/v1/tx.proto'),
        join(__dirname, '../../../proto-types/protos/ibc-go/ibc/core/connection/v1/query.proto'),
        join(__dirname, '../../../proto-types/protos/ibc-go/ibc/core/channel/v1/query.proto'),
        join(__dirname, '../../../proto-types/protos/ibc-go/ibc/core/channel/v1/tx.proto'),
        join(__dirname, '../../../proto-types/protos/ibc-go/ibc/applications/transfer/v1/query.proto'),
        join(__dirname, '../../../proto-types/protos/ibc-go/ibc/cardano/v1/tx.proto'),
        join(__dirname, '../../../proto-types/protos/ibc-go/ibc/cardano/v1/query.proto'),
      ],
      loader: {
        keepCase: true,
        includeDirs: [join(__dirname, '../../../', 'proto-types/protos/ibc-go/')],
      },
      credentials: createGrpcServerCredentials(env),
    },
  };
}

export const grpcClientOptions: GrpcOptions = createGrpcOptions();
