import http from 'http';
import { URL } from 'url';
import { connect } from 'net';
import { Pool } from 'pg';
import {
  BlockFetchBlock,
  BlockFetchClient,
  HandshakeAcceptVersion,
  HandshakeProposeVersion,
  MiniProtocol,
  Multiplexer,
  RealPoint,
  VersionData,
  handshakeMessageFromCborObj,
} from '@harmoniclabs/ouroboros-miniprotocols-ts';
import { fromHex } from '@harmoniclabs/uint8array-utils';
import { Cbor } from '@harmoniclabs/cbor';
import {
  AuxiliaryData,
  Block,
  Transaction,
  TransactionBody,
  TransactionWitnessSet,
  hash_transaction,
} from '@dcspark/cardano-multiplatform-lib-nodejs';

type TxBlockRow = {
  block_hash: Buffer;
  slot_no: string | number;
};

const port = Number(process.env.TX_CBOR_API_PORT || 8080);
const historyBackend = (process.env.HISTORY_BACKEND || 'dbsync').toLowerCase();
const cardanoChainHost = process.env.CARDANO_CHAIN_HOST || 'cardano-node';
const cardanoChainPort = Number(process.env.CARDANO_CHAIN_PORT || 3001);
const cardanoChainNetworkMagic = Number(process.env.CARDANO_CHAIN_NETWORK_MAGIC || process.env.CARDANO_NETWORK_MAGIC || 42);

const dbPool = new Pool({
  host: process.env.HISTORY_DB_HOST || process.env.DBSYNC_HOST || 'postgres',
  port: Number(process.env.HISTORY_DB_PORT || process.env.DBSYNC_PORT || 5432),
  database: process.env.HISTORY_DB_NAME || process.env.DBSYNC_NAME || 'cexplorer',
  user: process.env.HISTORY_DB_USERNAME || process.env.DBSYNC_USERNAME || 'postgres',
  password: process.env.HISTORY_DB_PASSWORD || process.env.DBSYNC_PASSWORD || '',
});

function json(res: http.ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(`${JSON.stringify(payload)}\n`);
}

async function findTxBlock(txHash: string): Promise<{ blockHash: string; slot: bigint }> {
  const dbSyncQuery = `
    SELECT
      block.hash AS block_hash,
      block.slot_no AS slot_no
    FROM tx
    INNER JOIN block ON block.id = tx.block_id
    WHERE tx.hash = $1
    LIMIT 1;
  `;
  const yaciQuery = `
    SELECT
      decode(block_hash, 'hex') AS block_hash,
      slot_no
    FROM bridge_tx_history
    WHERE tx_hash = $1
    LIMIT 1;
  `;
  const query = historyBackend === 'yaci' ? yaciQuery : dbSyncQuery;
  const params = historyBackend === 'yaci' ? [txHash.toLowerCase()] : [`\\x${txHash}`];
  const result = await dbPool.query<TxBlockRow>(query, params);
  if (result.rows.length === 0) {
    throw new Error(`Transaction ${txHash} not found`);
  }

  const row = result.rows[0];
  return {
    blockHash: row.block_hash.toString('hex'),
    slot: BigInt(row.slot_no),
  };
}

async function performHandshake(multiplexer: Multiplexer) {
  return new Promise<void>((resolve, reject) => {
    multiplexer.on(MiniProtocol.Handshake, (chunk) => {
      try {
        const msg = handshakeMessageFromCborObj(Cbor.parse(chunk));
        if (msg instanceof HandshakeAcceptVersion) {
          multiplexer.clearListeners(MiniProtocol.Handshake);
          resolve();
          return;
        }
        multiplexer.clearListeners(MiniProtocol.Handshake);
        reject(new Error(`Handshake rejected by node: ${JSON.stringify(msg)}`));
      } catch (error) {
        multiplexer.clearListeners(MiniProtocol.Handshake);
        reject(error);
      }
    });

    multiplexer.send(
      new HandshakeProposeVersion({
        versionTable: {
          [14]: new VersionData({
            initiatorOnlyDiffusionMode: false,
            peerSharing: false,
            query: false,
            networkMagic: cardanoChainNetworkMagic,
          }),
          [13]: new VersionData({
            initiatorOnlyDiffusionMode: false,
            peerSharing: false,
            query: false,
            networkMagic: cardanoChainNetworkMagic,
          }),
        },
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

async function fetchBlock(blockHash: string, slot: bigint): Promise<Block> {
  const startPoint = new RealPoint({
    blockHeader: {
      hash: fromHex(blockHash),
      slotNumber: slot,
    },
  });

  const socket = connect({
    host: cardanoChainHost,
    port: cardanoChainPort,
    keepAlive: false,
    keepAliveInitialDelay: 0,
    timeout: 1000,
  });

  const multiplexer = new Multiplexer({
    protocolType: 'node-to-node',
    connect: () => socket,
  });

  const closeTransport = () => {
    socket.destroy();
    multiplexer.close({ closeSocket: true });
  };
  socket.on('close', () => multiplexer.close({ closeSocket: true }));
  socket.on('error', () => closeTransport());

  try {
    await performHandshake(multiplexer);
    const client = new BlockFetchClient(multiplexer);
    const fetched = await client.request(startPoint);
    client.removeAllListeners();
    client.mplexer.close({ closeSocket: true });
    socket.destroy();

    if (!(fetched instanceof BlockFetchBlock)) {
      throw new Error(`Block ${blockHash} not available from local node`);
    }

    const blockBytes = fetched.getBlockBytes();
    if (!blockBytes) {
      throw new Error(`Block ${blockHash} returned no bytes`);
    }
    return Block.from_cbor_bytes(blockBytes.slice(2));
  } catch (error) {
    closeTransport();
    throw error;
  }
}

function findTransactionCbor(block: Block, txHash: string): string {
  const wanted = txHash.toLowerCase();
  const txBodies = block.transaction_bodies();
  const txWitnesses = block.transaction_witness_sets();
  const txAuxData = block.auxiliary_data_set();
  const invalidTransactions = new Set(Array.from(block.invalid_transactions()));

  for (let i = 0; i < txBodies.len(); i++) {
    const body = txBodies.get(i) as TransactionBody;
    const computedHash = hash_transaction(body).to_hex().toLowerCase();
    if (computedHash !== wanted) {
      continue;
    }

    const witnessSet = txWitnesses.get(i) as TransactionWitnessSet;
    const auxiliaryData = txAuxData.get(i) as AuxiliaryData | undefined;
    const tx = Transaction.new(body, witnessSet, !invalidTransactions.has(i), auxiliaryData);
    return tx.to_cbor_hex();
  }

  throw new Error(`Transaction ${txHash} not found in fetched block`);
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    json(res, 400, { error: 'Missing request URL' });
    return;
  }

  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/healthz') {
    json(res, 200, { ok: true });
    return;
  }

  const match = url.pathname.match(/^\/txs\/([0-9a-fA-F]+)\/cbor$/);
  if (!match) {
    json(res, 404, { error: 'Not found' });
    return;
  }

  const txHash = match[1].toLowerCase();
  try {
    const { blockHash, slot } = await findTxBlock(txHash);
    const block = await fetchBlock(blockHash, slot);
    const cbor = findTransactionCbor(block, txHash);
    json(res, 200, { cbor });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = message.includes('not found') ? 404 : 500;
    json(res, statusCode, { error: message });
  }
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`local-tx-cbor-api listening on ${port}\n`);
});
