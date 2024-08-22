import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BlockFetchBlock,
  BlockFetchNoBlocks,
  BlockFetchClient,
  RealPoint,
  ChainSyncClient,
  MiniProtocol,
  Multiplexer,
  N2NHandshakeVersion,
  N2NMessageAcceptVersion,
  N2NMessageProposeVersion,
  n2nHandshakeMessageFromCbor,
} from '@harmoniclabs/ouroboros-miniprotocols-ts';
import { Block } from '@dcspark/cardano-multiplatform-lib-nodejs';
import { fromHex } from '@harmoniclabs/uint8array-utils';
import cbor from 'cbor';

import { BlockHeaderDto } from './dtos/block-header.dto';
import { Socket, connect } from 'net';
import { writeFileSync } from 'fs';
import { toHex } from '../../helpers/hex';

@Injectable()
export class MiniProtocalsService {
  constructor(
    private configService: ConfigService,
    private readonly logger: Logger,
  ) {}

  async fetchBlockHeader(blockHash: string, slotNumber: bigint): Promise<BlockHeaderDto> {
    const startPoint = new RealPoint({
      blockHeader: {
        hash: fromHex(blockHash),
        slotNumber: slotNumber,
      },
    });

    // const blockFetched = await this.peerClient.request(startPoint);
    const blockFetched = await this._initialBlockFetchClientAndRequestPoint(startPoint);

    if (blockFetched instanceof BlockFetchBlock) {
      const blockBytes = blockFetched.getBlockBytes();
      if (blockBytes !== undefined) {
        const block = Block.from_cbor_bytes(blockBytes?.slice(2));
        const blockHeader: BlockHeaderDto = {
          headerCbor: block.header().to_cbor_hex(),
          bodyCbor: await this._getBlockBodiesCborFromBlockData(block),
          prevHash: block.header().header_body().prev_hash().to_hex(),
        };

        return blockHeader;
      }
    }

    return null;
  }

  async _getBlockBodiesCborFromBlockData(block: Block): Promise<string> {
    const txBodies = block.transaction_bodies();
    const txWitnesses = block.transaction_witness_sets();
    const txAuxData = block.auxiliary_data_set();
    const txsLength = txBodies.len();
    const txsCbor = [];

    for (let i = 0; i < txsLength; i++) {
      const txsCborItem = [txBodies.get(i).to_cbor_hex(), txWitnesses.get(i).to_cbor_hex()];
      if (txAuxData.get(i)) txsCborItem.push(txAuxData.get(i).to_cbor_hex());
      else txsCborItem.push('');

      txsCbor.push(txsCborItem);
    }

    const cborBuff = await cbor.encodeAsync(txsCbor);
    return toHex(cborBuff);
  }

  async _initialBlockFetchClientAndRequestPoint(startPoint: RealPoint): Promise<BlockFetchBlock | BlockFetchNoBlocks> {
    let socket = connect({
      host: this.configService.get('cardanoChainHost'),
      port: this.configService.get('cardanoChainPort'),
      keepAlive: false,
      keepAliveInitialDelay: 0,
      timeout: 1000,
    });

    try {
      const mplexer: Multiplexer = new Multiplexer({
        protocolType: 'node-to-node',
        connect: () => {
          // this.logger.log(`Multiplexer connect: destroyed = ${socket.destroyed}`);
          if (socket.destroyed) {
            socket.destroy();
            mplexer.close({
              closeSocket: true,
            });
          }
          return socket;
        },
      });
      socket.on('close', () => {
        mplexer.close({
          closeSocket: true,
        });
      });
      socket.on('error', () => {
        socket.destroy();
        mplexer.close({
          closeSocket: true,
        });
      });

      await this._performHandshake(mplexer, this.configService.get('cardanoChainNetworkMagic'));
      const client: BlockFetchClient = new BlockFetchClient(mplexer);
      client.on('error', (err) => {
        this.logger.error('BlockFetchClient error', err);
        throw err;
      });
      const res = await client.request(startPoint);

      client.removeAllListeners(); // This is not in the original code, but it is necessary to avoid memory leaks
      client.mplexer.close({ closeSocket: true });

      return res;
    } catch (error) {
      this.logger.error('Fetch Block Err: ', error);
    } finally {
      socket.destroy();
    }
  }

  async _performHandshake(mplexer: Multiplexer, networkMagic: number) {
    return new Promise<void>((resolve, reject) => {
      mplexer.on(MiniProtocol.Handshake, (chunk) => {
        const msg = n2nHandshakeMessageFromCbor(chunk);

        if (msg instanceof N2NMessageAcceptVersion) {
          mplexer.clearListeners(MiniProtocol.Handshake);
          resolve();
        } else {
          this.logger.error('connection refused', msg);
          throw new Error('handle rejection');
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
}
