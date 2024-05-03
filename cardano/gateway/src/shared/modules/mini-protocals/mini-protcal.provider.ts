import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  BlockFetchClient,
  ChainSyncClient,
  MiniProtocol,
  Multiplexer,
  N2NHandshakeVersion,
  N2NMessageAcceptVersion,
  N2NMessageProposeVersion,
  n2nHandshakeMessageFromCbor,
} from '@harmoniclabs/ouroboros-miniprotocols-ts';
import { Socket, connect } from 'net';

export const BLOCK_FETCH_CLIENT = 'LUCID_CLIENT';

export const BlockFetchClientService = {
  provide: BLOCK_FETCH_CLIENT,
  useFactory: async (configService: ConfigService) => {
    let socket = connect({
      host: configService.get('cardanoChainHost'),
      port: configService.get('cardanoChainPort'),
      keepAlive: false,
      keepAliveInitialDelay: 0,
      timeout: 10000,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 5000,
    });
    let mplexer: Multiplexer = new Multiplexer({
      protocolType: 'node-to-node',
      connect: () =>{
        if (socket.destroyed) {
          socket = null;
          socket = connect({
            host: configService.get('cardanoChainHost'),
            port: configService.get('cardanoChainPort'),
            keepAlive: false,
            keepAliveInitialDelay: 0,
            timeout: 10000,
            autoSelectFamily: true,
            autoSelectFamilyAttemptTimeout: 5000,
          })
        }
        
        
        return socket;
      },
    });
    await performHandshake(mplexer, configService.get('cardanoChainNetworkMagic'));
    const client: BlockFetchClient = new BlockFetchClient(mplexer);
    client.on('error', (err) => {
      Logger.error('BlockFetchClient error', err);
      throw err;
    });

    return client;
  },
  inject: [ConfigService],
};

async function performHandshake(mplexer: Multiplexer, networkMagic: number) {
  return new Promise<void>((resolve, reject) => {
    mplexer.on(MiniProtocol.Handshake, (chunk) => {
      const msg = n2nHandshakeMessageFromCbor(chunk);

      if (msg instanceof N2NMessageAcceptVersion) {
        mplexer.clearListeners(MiniProtocol.Handshake);
        Logger.log('connected to node', (mplexer.socket.unwrap() as Socket).remoteAddress);
        resolve();
      } else {
        Logger.error('connection refused', msg);
        throw new Error('TODO: handle rejection');
      }
    });

    mplexer.send(
      new N2NMessageProposeVersion({
        versionTable: [
          {
            version: N2NHandshakeVersion.v10,
            data: {
              networkMagic,
              initiatorAndResponderDiffusionMode: false,
              peerSharing: 0,
              query: false,
            },
          },
        ],
      })
        .toCbor()
        .toBuffer(),
      {
        hasAgency: true,
        protocol: MiniProtocol.Handshake,
      },
    );
  });
}
