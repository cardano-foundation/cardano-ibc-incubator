import { ServerCredentials } from '@grpc/grpc-js';
import { GrpcOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';

export const grpcClientOptions: GrpcOptions = {
  transport: Transport.GRPC,
  options: {
    url: '0.0.0.0:5001',
    package: ['ibc.core.client.v1', 'ibc.core.types.v1', 'ibc.core.connection.v1', 'ibc.core.channel.v1'],
    protoPath: [
      join(__dirname, '../../cosmjs-types/protos/ibc-go/ibc/core/client/v1/tx.proto'),
      join(__dirname, '../../cosmjs-types/protos/ibc-go/ibc/core/client/v1/query.proto'),
      join(__dirname, '../../cosmjs-types/protos/ibc-go/ibc/core/types/v1/query.proto'),
      join(__dirname, '../../cosmjs-types/protos/ibc-go/ibc/core/connection/v1/tx.proto'),
      join(__dirname, '../../cosmjs-types/protos/ibc-go/ibc/core/connection/v1/query.proto'),
      join(__dirname, '../../cosmjs-types/protos/ibc-go/ibc/core/channel/v1/query.proto'),
      join(__dirname, '../../cosmjs-types/protos/ibc-go/ibc/core/channel/v1/tx.proto'),
    ],
    loader: {
      keepCase: true,
      includeDirs: [join(__dirname, '../../', 'cosmjs-types/protos/ibc-go/')],
    },
    credentials: ServerCredentials.createInsecure(),
  },
};
