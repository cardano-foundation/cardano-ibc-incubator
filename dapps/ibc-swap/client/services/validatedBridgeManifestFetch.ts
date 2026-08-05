import {
  assertBridgeManifestMatchesIdentity,
  resolveRuntimeIdentity,
} from '@/configs/runtimeIdentity';
import {
  CARDANO_BRIDGE_MANIFEST_URL,
  CARDANO_CHAIN_ID,
  CARDANO_IBC_CHAIN_ID,
  CARDANO_NETWORK,
  IBC_SWAP_MODE,
} from '@/configs/runtime';

const configuredIdentity = resolveRuntimeIdentity({
  NEXT_PUBLIC_IBC_SWAP_MODE: IBC_SWAP_MODE,
  NEXT_PUBLIC_CARDANO_NETWORK: CARDANO_NETWORK,
  NEXT_PUBLIC_CARDANO_CHAIN_ID: CARDANO_CHAIN_ID,
  NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID: CARDANO_IBC_CHAIN_ID,
});

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function requestUrl(input: FetchInput): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export async function fetchCardanoResource(
  input: FetchInput,
  init?: FetchInit,
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.ok && requestUrl(input) === CARDANO_BRIDGE_MANIFEST_URL) {
    const manifest = (await response.clone().json()) as unknown;
    assertBridgeManifestMatchesIdentity(manifest, configuredIdentity);
  }
  return response;
}
