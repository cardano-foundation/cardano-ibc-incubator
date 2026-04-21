import type WebSocket from 'ws';

type KupmiosHeaders = {
  kupoHeader?: Record<string, string>;
  ogmiosHeader?: Record<string, string>;
};

type ServiceAuthRule = {
  host: string;
  apiKey: string;
};

let authFetchInstalled = false;

function trimTrailingSlash(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\/$/, '');
}

function normalizeDmtrHost(url: string, apiKey?: string): URL {
  const parsedUrl = new URL(url);
  if (apiKey && parsedUrl.host.startsWith(`${apiKey}.`)) {
    parsedUrl.host = parsedUrl.host.replace(`${apiKey}.`, '');
  }
  return parsedUrl;
}

export function resolveManagedOgmiosHttpEndpoint(
  rawUrl?: string | null,
  apiKey?: string | null,
): string | undefined {
  const trimmed = trimTrailingSlash(rawUrl);
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'wss:') {
      parsed.protocol = 'https:';
    } else if (parsed.protocol === 'ws:') {
      parsed.protocol = 'http:';
    }
    // DMTR Ogmios HTTP JSON-RPC is method-sensitive on authenticated hostnames:
    // queryNetwork/startTime may work there, but queryLedgerState/protocolParameters
    // returns 401. Use the base host and send `dmtr-api-key` explicitly.
    return normalizeDmtrHost(parsed.toString(), apiKey ?? undefined).toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

export function resolveManagedOgmiosWsEndpoint(
  rawUrl?: string | null,
  apiKey?: string | null,
): string | undefined {
  const trimmed = trimTrailingSlash(rawUrl);
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') {
      parsed.protocol = 'wss:';
    } else if (parsed.protocol === 'http:') {
      parsed.protocol = 'ws:';
    }
    // DMTR Ogmios websocket auth is bound to the authenticated hostname itself.
    // Normalizing back to the base host causes a 401 on the websocket upgrade even
    // when the same API key works for HTTP JSON-RPC.
    void apiKey;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

export function resolveManagedKupoEndpoint(
  rawUrl?: string | null,
  apiKey?: string | null,
): string | undefined {
  const trimmed = trimTrailingSlash(rawUrl);
  if (!trimmed) {
    return undefined;
  }

  try {
    // DMTR Kupo accepts provider-level wildcard out-ref lookups when requests carry
    // `dmtr-api-key`. Prefer the normalized host so the API key is not duplicated in the URL.
    return normalizeDmtrHost(trimmed, apiKey ?? undefined).toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

export function resolveManagedKupmiosHeaders(
  kupoUrl?: string | null,
  kupoApiKey?: string | null,
  ogmiosUrl?: string | null,
  ogmiosApiKey?: string | null,
): KupmiosHeaders | undefined {
  const headers: KupmiosHeaders = {};
  const trimmedKupoApiKey = kupoApiKey?.trim();
  if (trimmedKupoApiKey) {
    headers.kupoHeader = { 'dmtr-api-key': trimmedKupoApiKey };
  }
  const trimmedOgmiosApiKey = ogmiosApiKey?.trim();
  if (trimmedOgmiosApiKey) {
    headers.ogmiosHeader = { 'dmtr-api-key': trimmedOgmiosApiKey };
  }
  return headers.kupoHeader || headers.ogmiosHeader ? headers : undefined;
}

export function resolveManagedOgmiosWsOptions(
  rawUrl?: string | null,
  ogmiosApiKey?: string | null,
): WebSocket.ClientOptions | undefined {
  if (!ogmiosApiKey?.trim()) {
    return undefined;
  }

  const trimmedUrl = trimTrailingSlash(rawUrl);
  void trimmedUrl;
  // Keep websocket auth explicit whenever we have a DMTR Ogmios key. The authenticated host
  // can accept the upgrade without the header in some contexts, but the Gateway runtime still
  // sees intermittent 401 handshakes unless we send `dmtr-api-key` consistently.
  return {
    headers: {
      'dmtr-api-key': ogmiosApiKey.trim(),
    },
  };
}

function resolveServiceAuthRules(
  rawUrl?: string | null,
  apiKey?: string | null,
): ServiceAuthRule[] {
  const trimmedUrl = trimTrailingSlash(rawUrl);
  const trimmedApiKey = apiKey?.trim();
  if (!trimmedUrl || !trimmedApiKey) {
    return [];
  }

  try {
    const parsed = new URL(trimmedUrl);
    const rules = [{ host: parsed.host, apiKey: trimmedApiKey }];
    const normalized = normalizeDmtrHost(trimmedUrl, trimmedApiKey);
    if (normalized.host !== parsed.host) {
      rules.push({ host: normalized.host, apiKey: trimmedApiKey });
    }
    return rules;
  } catch {
    return [];
  }
}

export function installManagedCardanoAuthFetch(
  kupoUrl?: string | null,
  kupoApiKey?: string | null,
  ogmiosUrl?: string | null,
  ogmiosApiKey?: string | null,
): void {
  if (authFetchInstalled || typeof globalThis.fetch !== 'function') {
    return;
  }

  const authRules = new Map<string, string>();
  for (const rule of resolveServiceAuthRules(
    kupoUrl,
    kupoApiKey,
  )) {
    authRules.set(rule.host, rule.apiKey);
  }
  for (const rule of resolveServiceAuthRules(
    resolveManagedOgmiosHttpEndpoint(ogmiosUrl, ogmiosApiKey),
    ogmiosApiKey,
  )) {
    authRules.set(rule.host, rule.apiKey);
  }

  if (authRules.size === 0) {
    return;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : typeof (input as { href?: unknown }).href === 'string'
              ? ((input as { href: string }).href)
              : typeof (input as { url?: unknown }).url === 'string'
                ? ((input as { url: string }).url)
                : undefined;

    if (!requestUrl) {
      return originalFetch(input as any, init);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(requestUrl);
    } catch {
      return originalFetch(input as any, init);
    }

    const apiKey = authRules.get(parsedUrl.host);
    if (!apiKey) {
      return originalFetch(input as any, init);
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (!headers.has('dmtr-api-key')) {
      headers.set('dmtr-api-key', apiKey);
    }

    if (input instanceof Request) {
      return originalFetch(
        new Request(parsedUrl.toString(), {
          method: input.method,
          headers,
          body: init?.body ?? input.body,
          redirect: input.redirect,
          integrity: input.integrity,
          keepalive: input.keepalive,
          mode: input.mode,
          signal: init?.signal ?? input.signal,
        }),
      );
    }

    return originalFetch(parsedUrl.toString(), { ...init, headers });
  }) as typeof fetch;

  authFetchInstalled = true;
}
