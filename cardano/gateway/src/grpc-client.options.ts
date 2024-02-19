import { ServerCredentials } from '@grpc/grpc-js';
import { GrpcOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';

export const grpcClientOptions: GrpcOptions = {
  transport: Transport.GRPC,
  options: {
    url: '0.0.0.0:5001',
    package: ['ibc.core.client.v1'],
    protoPath: [
      join(__dirname, '../../cosmjs-types/protos/ibc-go/ibc/core/client/v1/tx.proto'),
      join(__dirname, '../../cosmjs-types/protos/ibc-go/ibc/core/client/v1/query.proto'),
    ],
    loader: {
      keepCase: true,
      includeDirs: [join(__dirname, '../../', 'cosmjs-types/protos/ibc-go/')],
    },
    credentials: ServerCredentials.createInsecure(),
  },
};
