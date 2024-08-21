// import { osmosis } from 'osmojs';

import { IBCDenomTrace } from '@/types/IBCParams';
import { fetchAllDenomTraces } from './CommonCosmosServices';
import {
  OSMOSIS_MAINNET_REST_ENDPOINT,
  // OSMOSIS_MAINNET_RPC_ENDPOINT,
} from '@/constants';

export async function fetchOsmosisDenomTraces(): Promise<IBCDenomTrace> {
  const restUrl =
    process.env.NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT ||
    OSMOSIS_MAINNET_REST_ENDPOINT;
  return fetchAllDenomTraces(restUrl);
}

// export async function getOsmosisPools() {
//   const rpcUrl =
//     // process.env.NEXT_PUBLIC_LOCALOSMOIS_RPC_ENDPOINT ||
//     OSMOSIS_MAINNET_RPC_ENDPOINT;
//   const { createRPCQueryClient } = osmosis.ClientFactory;
//   const client = await createRPCQueryClient({ rpcEndpoint: rpcUrl });

//   const gamm = await client.osmosis.gamm.v1beta1.pools({
//     pagination: {
//       limit: BigInt(100000),
//       offset: BigInt(0),
//       countTotal: false,
//       reverse: false,
//       key: Uint8Array.from([]),
//     },
//   });
//   console.log(`gamm:`, gamm.pools);

//   const concentratedliquidity = await client.osmosis.concentratedliquidity.v1beta1.pools({
//     pagination: {
//       limit: BigInt(100000),
//       offset: BigInt(0),
//       countTotal: false,
//       reverse: false,
//       key: Uint8Array.from([]),
//     },
//   });
//   console.log(`concentratedliquidity:`, concentratedliquidity.pools);

//   const cosmwasmpool = await client.osmosis.cosmwasmpool.v1beta1.pools({
//     pagination: {
//       limit: BigInt(100000),
//       offset: BigInt(0),
//       countTotal: false,
//       reverse: false,
//       key: Uint8Array.from([]),
//     },
//   });
//   console.log(`cosmwasmpool:`, cosmwasmpool.pools);
// }
