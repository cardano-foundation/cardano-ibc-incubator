import type {
  MsgCreateClient,
  MsgCreateClientResponse,
  MsgUpgradeClient,
  MsgUpgradeClientResponse,
  MsgRecoverClient,
  MsgRecoverClientResponse,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '@cardano-ibc/proto-types/build/ibc/core/client/v1/tx';

export const LIGHT_CLIENT_HANDLERS = Symbol('LIGHT_CLIENT_HANDLERS');

/** A compiled-in client implementation; requests cannot install handlers. */
export interface LightClientHandler {
  readonly clientType: string;
  readonly clientStateTypeUrl: string;
  readonly consensusStateTypeUrl: string;
  readonly clientMessageTypeUrls: readonly string[];
  readonly service: {
    createClient(request: MsgCreateClient): Promise<MsgCreateClientResponse>;
    updateClient(request: MsgUpdateClient): Promise<MsgUpdateClientResponse>;
    upgradeClient?(request: MsgUpgradeClient): Promise<MsgUpgradeClientResponse>;
    recoverClient(request: MsgRecoverClient): Promise<MsgRecoverClientResponse>;
  };
}
