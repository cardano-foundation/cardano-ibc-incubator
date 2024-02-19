import { ConnectionConfig } from '@cardano-ogmios/client';
import * as dotenv from 'dotenv';

dotenv.config();

export const kupmiosConfig = {
  ogmios: process.env.OGMIOS_ENDPOINT,
  kupo: process.env.KUPO_ENDPOINT,
};

const _128MB = 128 * 1024 * 1024;

export const connectionConfig: ConnectionConfig = {
  host: new URL(process.env.OGMIOS_ENDPOINT).hostname || 'localhost',
  port: Number(new URL(process.env.OGMIOS_ENDPOINT).port) || 1337,
  tls: false,
  maxPayload: _128MB,
};
