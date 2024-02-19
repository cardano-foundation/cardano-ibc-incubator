import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  MsgCreateClientResponse,
  MsgCreateClient,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '../../cosmjs-types/src/ibc/core/client/v1/tx';

import { TxService } from './tx.service';

@Controller()
export class TxController {
  constructor(private readonly txService: TxService) {}

  @GrpcMethod('Msg', 'CreateClient')
  async CreateClient(data: MsgCreateClient): Promise<MsgCreateClientResponse> {
    const response: MsgCreateClientResponse = await this.txService.createClient(data);
    return response;
  }
  @GrpcMethod('Msg', 'UpdateClient')
  async UpdateClient(data: MsgUpdateClient): Promise<MsgUpdateClientResponse> {
    const response: MsgUpdateClientResponse = await this.txService.updateClient(data);
    return response;
  }
}
