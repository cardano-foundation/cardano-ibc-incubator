import * as config_pb from "../proto/protoc/config";
import { ServerUnaryCall, sendUnaryData } from "@grpc/grpc-js";
import { RichServerError } from "nice-grpc-error-details";
import * as config from "../relayer-config/config";
import { logger } from "../logger/logger";
import fs from "fs";
import { Status } from "@grpc/grpc-js/build/src/constants";

export class Config extends config_pb.config.UnimplementedConfigServiceService {
  async UpdatePathConfig(
    call: ServerUnaryCall<
      config_pb.config.UpdatePathConfigRequest,
      config_pb.config.UpdatePathConfigResponse
    >,
    callback: sendUnaryData<config_pb.config.UpdatePathConfigResponse>
  ) {
    try {
      const newPathConfig = call.request.path;

      const oldPathConfig = config.GetPathConfig();

      if (newPathConfig === oldPathConfig) {
        throw new RichServerError(
          Status.INVALID_ARGUMENT,
          "Invalid Path Config: This path config is used"
        );
      }

      if (!fs.existsSync(newPathConfig)) {
        throw new RichServerError(
          Status.NOT_FOUND,
          "Invalid Path Config: Path config not found" + newPathConfig
        );
      }

      config.UpdatePathConfig(newPathConfig);

      const res = new config_pb.config.UpdatePathConfigResponse({});

      logger.print(
        `[Config Service] [API UpdatePathConfig] [Status: Success] [Request: {path: ${newPathConfig}}] [Response: {}]`
      );
      callback(null, res);
    } catch (err) {
      logger.print(
        `[Config Service] [API UpdatePathConfig] [Status: Error] [Request: {path: ${call.request.path}}]` +
          " Error Msg: " +
          err +
          "]"
      );
      callback(err, null);
    }
  }

  async ShowPathConfig(
    call: ServerUnaryCall<
      config_pb.config.ShowPathConfigRequest,
      config_pb.config.ShowPathConfigResponse
    >,
    callback: sendUnaryData<config_pb.config.ShowPathConfigResponse>
  ) {
    try {
      const pathConfig = config.GetPathConfig();
      const res = new config_pb.config.ShowPathConfigResponse({
        path: pathConfig,
      });
      logger.print(
        `[Config Service] [API ShowPathConfig] [Status: Success] [Request: {}] [Response: {path: ${pathConfig}}]`
      );
      callback(null, res);
    } catch (err) {
      logger.print(
        `[Config Service] [API ShowPathConfig] [Status: Error] [Request: {}]` +
          " [Error Msg: " +
          err +
          "]"
      );
      callback(err, null);
    }
  }
}
