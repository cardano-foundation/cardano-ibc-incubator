type ServiceAuthRule = {
  host: string;
  apiKey: string;
  isAuthenticatedHost: boolean;
  attachHeader: boolean;
};

type KupmiosHeaders = {
  kupoHeader?: Record<string, string>;
  ogmiosHeader?: Record<string, string>;
};

export type ManagedRequestVariant = {
  baseUrl: string;
  headers?: Record<string, string>;
};

let authFetchInstalled = false;

function resolveServiceAuthRule(
  urlEnvName: string,
  apiKeyEnvName: string,
): ServiceAuthRule | null {
  const rawUrl = Deno.env.get(urlEnvName)?.trim();
  const apiKey = Deno.env.get(apiKeyEnvName)?.trim();
  if (!rawUrl || !apiKey) {
    return null;
  }
  return resolveDmtrRule(rawUrl, apiKey, urlEnvName === "KUPO_URL");
}

function resolveDmtrRule(rawUrl: string, apiKey: string, _isKupoRule: boolean): ServiceAuthRule | null {
  try {
    const parsedUrl = new URL(rawUrl);
    const isAuthenticatedHost = parsedUrl.host.startsWith(`${apiKey}.`);
    return {
      host: parsedUrl.host,
      apiKey,
      isAuthenticatedHost,
      attachHeader: !isAuthenticatedHost,
    };
  } catch {
    return null;
  }
}

export function resolveManagedKupoUrl(rawUrl: string, apiKey?: string): string {
  void apiKey;
  return rawUrl.replace(/\/$/, "");
}

export function resolveManagedKupoAuthUrl(rawUrl: string): string {
  return rawUrl.replace(/\/$/, "");
}

export function resolveManagedKupoHeader(
  rawUrl: string,
  apiKey?: string,
): Record<string, string> | undefined {
  if (!apiKey) {
    return undefined;
  }

  const kupoRule = resolveDmtrRule(rawUrl, apiKey, true);
  if (!kupoRule?.attachHeader) {
    return undefined;
  }

  return { "dmtr-api-key": apiKey };
}

export function resolveManagedKupoRequestVariants(
  rawUrl: string,
  apiKey?: string,
): ManagedRequestVariant[] {
  const trimmedUrl = rawUrl.replace(/\/$/, "");
  const variants: ManagedRequestVariant[] = [];
  const seen = new Set<string>();

  const pushVariant = (
    baseUrl: string,
    headers?: Record<string, string>,
  ) => {
    const normalizedUrl = baseUrl.replace(/\/$/, "");
    const headerKey = JSON.stringify(headers ?? {});
    const dedupeKey = `${normalizedUrl}|${headerKey}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    variants.push({
      baseUrl: normalizedUrl,
      headers,
    });
  };

  pushVariant(trimmedUrl);

  if (!apiKey) {
    return variants;
  }

  const managedHeader = { "dmtr-api-key": apiKey };
  pushVariant(trimmedUrl, managedHeader);

  try {
    const parsedUrl = new URL(trimmedUrl);
    if (parsedUrl.host.startsWith(`${apiKey}.`)) {
      parsedUrl.host = parsedUrl.host.replace(`${apiKey}.`, "");
      pushVariant(parsedUrl.toString(), managedHeader);
    }
  } catch {
    // Fall back to the raw URL only when we cannot parse the managed host.
  }

  return variants;
}

export function resolveManagedOgmiosUrl(rawUrl: string, apiKey?: string): string {
  if (!apiKey) {
    return rawUrl.replace(/\/$/, "");
  }

  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.host.startsWith(`${apiKey}.`)) {
      parsedUrl.host = parsedUrl.host.replace(`${apiKey}.`, "");
    }
    return parsedUrl.toString().replace(/\/$/, "");
  } catch {
    return rawUrl.replace(/\/$/, "");
  }
}

export function resolveManagedKupmiosHeaders(
  kupoUrl: string,
  ogmiosUrl: string,
  kupoApiKey?: string,
  ogmiosApiKey?: string,
): KupmiosHeaders | undefined {
  const headers: KupmiosHeaders = {};

  if (kupoApiKey) {
    headers.kupoHeader = resolveManagedKupoHeader(kupoUrl, kupoApiKey);
  }

  if (ogmiosApiKey) {
    const ogmiosRule = resolveDmtrRule(ogmiosUrl, ogmiosApiKey, false);
    if (ogmiosRule?.attachHeader) {
      headers.ogmiosHeader = { "dmtr-api-key": ogmiosApiKey };
    }
  }

  return headers.kupoHeader || headers.ogmiosHeader ? headers : undefined;
}

export function installManagedCardanoAuthFetch(): void {
  if (authFetchInstalled) {
    return;
  }

  const authRules = [
    resolveServiceAuthRule("KUPO_URL", "KUPO_API_KEY"),
    resolveServiceAuthRule("OGMIOS_URL", "OGMIOS_API_KEY"),
    resolveServiceAuthRule("OGMIOS_HTTP_URL", "OGMIOS_API_KEY"),
  ].filter((rule): rule is ServiceAuthRule => rule !== null);

  const expandedRules = new Map<string, ServiceAuthRule>();
  for (const rule of authRules) {
    expandedRules.set(rule.host, rule);

    if (rule.isAuthenticatedHost) {
      const normalizedHost = rule.host.replace(`${rule.apiKey}.`, "");
      expandedRules.set(normalizedHost, {
        host: normalizedHost,
        apiKey: rule.apiKey,
        isAuthenticatedHost: false,
        attachHeader: true,
      });
    }
  }

  if (expandedRules.size === 0) {
    return;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(requestUrl);
    } catch {
      return originalFetch(input as any, init);
    }

    const authRule = expandedRules.get(parsedUrl.host);
    if (!authRule) {
      return originalFetch(input as any, init);
    }

    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    if (authRule.attachHeader && !headers.has("dmtr-api-key")) {
      headers.set("dmtr-api-key", authRule.apiKey);
    }

    if (input instanceof Request) {
      return originalFetch(new Request(parsedUrl.toString(), {
        method: input.method,
        headers,
        body: init?.body ?? input.body,
        redirect: input.redirect,
        integrity: input.integrity,
        keepalive: input.keepalive,
        mode: input.mode,
        signal: init?.signal ?? input.signal,
      }));
    }

    return originalFetch(parsedUrl.toString(), { ...init, headers });
  }) as typeof fetch;

  authFetchInstalled = true;
}
