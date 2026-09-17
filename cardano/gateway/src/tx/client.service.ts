import { Inject, Injectable } from '@nestjs/common';
import type {
  MsgCreateClient,
  MsgCreateClientResponse,
  MsgRecoverClient,
  MsgRecoverClientResponse,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '@cardano-ibc/proto-types/build/ibc/core/client/v1/tx';
import { GrpcInvalidArgumentException } from '../exception/grpc_exceptions';
import { LIGHT_CLIENT_HANDLERS, type LightClientHandler } from './light-client-handler';

/** Dispatch only: client-specific decoding and transaction construction live in handlers. */
@Injectable()
export class ClientService {
  private readonly byType = new Map<string, LightClientHandler>();
  private readonly byStateTypeUrl = new Map<string, LightClientHandler>();

  constructor(@Inject(LIGHT_CLIENT_HANDLERS) handlers: readonly LightClientHandler[]) {
    for (const handler of handlers) {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handler.clientType) ||
        !handler.clientStateTypeUrl ||
        !handler.consensusStateTypeUrl ||
        handler.clientMessageTypeUrls.length === 0
      ) {
        throw new Error('Invalid light-client handler registration');
      }
      if (this.byType.has(handler.clientType) || this.byStateTypeUrl.has(handler.clientStateTypeUrl)) {
        throw new Error(`Duplicate light-client handler: ${handler.clientType}`);
      }
      this.byType.set(handler.clientType, handler);
      this.byStateTypeUrl.set(handler.clientStateTypeUrl, handler);
    }
  }

  async createClient(request: MsgCreateClient): Promise<MsgCreateClientResponse> {
    if (!request.client_state || !request.consensus_state) {
      throw new GrpcInvalidArgumentException('client_state and consensus_state are required');
    }
    const handler = this.byStateTypeUrl.get(request.client_state.type_url);
    if (!handler) {
      throw new GrpcInvalidArgumentException(`Unsupported client state type: ${request.client_state.type_url}`);
    }
    if (request.consensus_state.type_url !== handler.consensusStateTypeUrl) {
      throw new GrpcInvalidArgumentException(`Consensus state type does not match ${handler.clientType}`);
    }
    return handler.service.createClient(request);
  }

  async updateClient(request: MsgUpdateClient): Promise<MsgUpdateClientResponse> {
    const handler = this.forClientId(request.client_id);
    if (!request.client_message || !handler.clientMessageTypeUrls.includes(request.client_message.type_url)) {
      throw new GrpcInvalidArgumentException(`Unsupported client message for ${handler.clientType}`);
    }
    return handler.service.updateClient(request);
  }

  async recoverClient(request: MsgRecoverClient): Promise<MsgRecoverClientResponse> {
    const subject = this.forClientId(request.subject_client_id);
    const substitute = this.forClientId(request.substitute_client_id);
    if (subject !== substitute) {
      throw new GrpcInvalidArgumentException('Recovery clients must use the same client type');
    }
    return subject.service.recoverClient(request);
  }

  private forClientId(clientId: string): LightClientHandler {
    const match = /^(.+)-(0|[1-9][0-9]*)$/.exec(clientId ?? '');
    const handler = match && this.byType.get(match[1]);
    if (!handler) {
      throw new GrpcInvalidArgumentException(`Invalid or unsupported client ID: ${clientId}`);
    }
    return handler;
  }
}
