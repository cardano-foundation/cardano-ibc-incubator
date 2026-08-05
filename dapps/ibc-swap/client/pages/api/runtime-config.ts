import type { NextApiRequest, NextApiResponse } from 'next';
import {
  selectPublicRuntimeEnvironment,
  validateRemoteKupmiosAuth,
} from '@/configs/publicRuntimeConfig';
import { resolveRuntimeIdentity } from '@/configs/runtimeIdentity';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('Method Not Allowed');
  }

  validateRemoteKupmiosAuth(process.env);
  const runtimeEnvironment = selectPublicRuntimeEnvironment(process.env);
  resolveRuntimeIdentity(runtimeEnvironment);

  const serialized = JSON.stringify(runtimeEnvironment).replace(
    /</g,
    '\\u003c',
  );
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res
    .status(200)
    .send(`window.ibcSwapRuntimeConfig = Object.freeze(${serialized});`);
}
