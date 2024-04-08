import * as grpc from "@grpc/grpc-js";
import * as transaction_pb from "./proto/protoc/transaction";
import * as key_pb from "./proto/protoc/key";
import * as config_pb from "./proto/protoc/config";
import { Transaction } from "./services/transaction";
import { Key } from "./services/key";
import { Config } from "./services/config";
import dotenv from "dotenv";
import { logger } from "./logger/logger";

dotenv.config({ path: ".env" });

const server = new grpc.Server();

server.addService(
  transaction_pb.tx.UnimplementedTransactionServiceService.definition,
  new Transaction()
);
server.addService(
  key_pb.key.UnimplementedKeyServiceService.definition,
  new Key()
);
server.addService(
  config_pb.config.UnimplementedConfigServiceService.definition,
  new Config()
);

const url = "0.0.0.0:" + process.env.PORT;

server.bindAsync(url, grpc.ServerCredentials.createInsecure(), () => {
  logger.print(`Server Started at ${url}`);
  server.start();
});
