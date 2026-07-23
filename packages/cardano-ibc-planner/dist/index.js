"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteDiscoveryTimeoutError = exports.DEFAULT_ROUTE_DISCOVERY_TIMEOUT_MS = void 0;
exports.createPlannerClient = createPlannerClient;
const LOCAL_OSMOSIS_CHAIN_ID = 'localosmosis';
const QUERY_CHANNELS_PREFIX_URL = '/ibc/core/channel/v1/channels';
const QUERY_ALL_CHANNELS_URL = `${QUERY_CHANNELS_PREFIX_URL}?pagination.count_total=true&pagination.limit=10000`;
const GATEWAY_CHANNELS_URL = '/api/channels?key=&offset=0&limit=200&countTotal=false&reverse=false';
const QUERY_SWAP_ROUTER_STATE = '/cosmwasm/wasm/v1/contract/SWAP_ROUTER_ADDRESS/state?pagination.limit=100000000';
const SWAP_ROUTING_TABLE_PREFIX = '\x00\rrouting_table\x00D';
const BIGINT_ZERO = BigInt(0);
exports.DEFAULT_ROUTE_DISCOVERY_TIMEOUT_MS = 10_000;
class RouteDiscoveryTimeoutError extends Error {
    timeoutMs;
    constructor(timeoutMs) {
        const duration = timeoutMs % 1000 === 0
            ? `${timeoutMs / 1000} seconds`
            : `${timeoutMs} milliseconds`;
        super(`IBC route discovery timed out after ${duration}.`);
        this.name = 'RouteDiscoveryTimeoutError';
        this.timeoutMs = timeoutMs;
    }
}
exports.RouteDiscoveryTimeoutError = RouteDiscoveryTimeoutError;
function normalizeRouteDiscoveryTimeoutMs(timeoutMs) {
    return typeof timeoutMs === 'number' &&
        Number.isFinite(timeoutMs) &&
        timeoutMs > 0
        ? timeoutMs
        : exports.DEFAULT_ROUTE_DISCOVERY_TIMEOUT_MS;
}
async function withRouteDiscoveryTimeout(operation, timeoutMs) {
    const controller = new AbortController();
    let timeoutId;
    const timeoutError = new RouteDiscoveryTimeoutError(timeoutMs);
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort(timeoutError);
            reject(timeoutError);
        }, timeoutMs);
    });
    try {
        return await Promise.race([
            Promise.resolve().then(() => operation(controller.signal)),
            timeout,
        ]);
    }
    finally {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
    }
}
function createPlannerClient(config) {
    const resolvedConfig = {
        ...config,
        counterpartyChainId: config.counterpartyChainId?.trim() || LOCAL_OSMOSIS_CHAIN_ID,
        fetchImpl: config.fetchImpl || fetch,
        routeDiscoveryTimeoutMs: normalizeRouteDiscoveryTimeoutMs(config.routeDiscoveryTimeoutMs),
    };
    return {
        async planTransferRoute(request) {
            const fromChainId = request.fromChainId.trim();
            const toChainId = request.toChainId.trim();
            const tokenDenom = request.tokenDenom.trim();
            if (!fromChainId || !toChainId || !tokenDenom) {
                return {
                    foundRoute: false,
                    mode: null,
                    chains: [],
                    routes: [],
                    tokenTrace: null,
                    failureCode: 'invalid-request',
                    failureMessage: 'fromChainId, toChainId, and tokenDenom are required.',
                };
            }
            if (fromChainId === toChainId) {
                return {
                    foundRoute: true,
                    mode: 'same-chain',
                    chains: [fromChainId],
                    routes: [],
                    tokenTrace: {
                        kind: 'native',
                        path: '',
                        baseDenom: tokenDenom,
                        fullDenom: tokenDenom,
                    },
                };
            }
            const directPair = await withRouteDiscoveryTimeout((signal) => fetchDirectOsmosisChannelPair(resolvedConfig, signal), resolvedConfig.routeDiscoveryTimeoutMs);
            if (fromChainId === resolvedConfig.cardanoChainId &&
                toChainId === resolvedConfig.counterpartyChainId) {
                if (!directPair) {
                    return noDirectRoute(fromChainId, toChainId, request.expectedChainPath);
                }
                return {
                    foundRoute: true,
                    mode: 'native-forward',
                    chains: [fromChainId, toChainId],
                    routes: [`transfer/${directPair.cardanoChannel}`],
                    tokenTrace: {
                        kind: 'native',
                        path: '',
                        baseDenom: tokenDenom,
                        fullDenom: tokenDenom,
                    },
                };
            }
            if (fromChainId === resolvedConfig.counterpartyChainId &&
                toChainId === resolvedConfig.cardanoChainId) {
                if (!directPair) {
                    return noDirectRoute(fromChainId, toChainId, request.expectedChainPath);
                }
                return {
                    foundRoute: true,
                    mode: 'native-forward',
                    chains: [fromChainId, toChainId],
                    routes: [`transfer/${directPair.osmosisChannel}`],
                    tokenTrace: {
                        kind: tokenDenom.startsWith('ibc/') ? 'ibc_voucher' : 'native',
                        path: '',
                        baseDenom: tokenDenom,
                        fullDenom: tokenDenom,
                    },
                };
            }
            return noDirectRoute(fromChainId, toChainId, request.expectedChainPath);
        },
        async getLocalOsmosisSwapOptions() {
            const routeMap = await fetchCrossChainSwapRouterState(resolvedConfig);
            const toTokens = Array.from(new Set(routeMap.map((route) => route.outToken)))
                .sort()
                .map((tokenId) => ({
                token_id: tokenId,
                token_name: tokenId,
                token_logo: null,
            }));
            return {
                from_chain_id: resolvedConfig.cardanoChainId,
                from_chain_name: 'Cardano',
                to_chain_id: LOCAL_OSMOSIS_CHAIN_ID,
                to_chain_name: 'Local Osmosis',
                to_tokens: toTokens,
            };
        },
        async estimateLocalOsmosisSwap(request) {
            if (!/^\d+$/.test(request.tokenInAmount) ||
                BigInt(request.tokenInAmount) <= BIGINT_ZERO) {
                return buildEmptyEstimate('Input amount must be a positive integer amount.');
            }
            const directPair = await fetchDirectOsmosisChannelPair(resolvedConfig);
            if (!directPair) {
                return buildEmptyEstimate('No direct Cardano-to-Osmosis transfer channel is available.');
            }
            const routeMap = await fetchCrossChainSwapRouterState(resolvedConfig);
            const route = routeMap.find((candidate) => candidate.outToken === request.tokenOutDenom ||
                candidate.outToken.toLowerCase() === request.tokenOutDenom.toLowerCase());
            if (!route) {
                return buildEmptyEstimate('Cannot find match pool, please select another pair');
            }
            const estimate = await estimateSwapViaRest(resolvedConfig, request.tokenInAmount, route.inToken, route.route);
            return {
                message: estimate.message,
                tokenOutAmount: estimate.tokenOutAmount.toString(),
                tokenOutTransferBackAmount: estimate.tokenOutAmount.toString(),
                tokenSwapAmount: estimate.tokenSwapAmount.toString(),
                outToken: route.outToken,
                transferRoutes: [`transfer/${directPair.cardanoChannel}`],
                transferBackRoutes: [`transfer/${directPair.osmosisChannel}`],
                transferChains: [resolvedConfig.cardanoChainId, LOCAL_OSMOSIS_CHAIN_ID],
            };
        },
    };
}
function noDirectRoute(fromChainId, toChainId, expectedChainPath) {
    return {
        foundRoute: false,
        mode: null,
        chains: [fromChainId, toChainId],
        routes: [],
        tokenTrace: null,
        failureCode: 'no-route-found',
        failureMessage: `No direct transfer route exists from ${fromChainId} to ${toChainId}.`,
        routeDiagnostics: {
            expectedChainPath: expectedChainPath || [fromChainId, toChainId],
            missingHops: [
                {
                    fromChainId,
                    toChainId,
                    reason: 'no-channel-to-destination',
                    availableDestChainIds: [],
                },
            ],
        },
    };
}
async function fetchDirectOsmosisChannelPair(config, signal) {
    const fromCardano = await fetchDirectChannelPairFromCardano(config, signal);
    if (fromCardano) {
        return fromCardano;
    }
    const channels = await fetchOpenOsmosisChannels(config, signal);
    const selected = selectLatestChannel(channels);
    return selected
        ? {
            cardanoChannel: selected.counterparty.channel_id,
            osmosisChannel: selected.channel_id,
        }
        : null;
}
async function fetchDirectChannelPairFromCardano(config, signal) {
    if (!config.cardanoRestEndpoint) {
        return null;
    }
    const data = await fetchJson(`${config.cardanoRestEndpoint}${GATEWAY_CHANNELS_URL}`, config.fetchImpl, signal).catch(() => {
        throwIfAborted(signal);
        return { channels: [] };
    });
    const openChannels = (data.channels || []).filter((channel) => isOpenChannelState(channel.state) &&
        channel.port_id === 'transfer' &&
        channel.counterparty?.channel_id);
    const selected = selectLatestChannel(openChannels);
    return selected
        ? {
            cardanoChannel: selected.channel_id,
            osmosisChannel: selected.counterparty.channel_id,
        }
        : null;
}
async function fetchOpenOsmosisChannels(config, signal) {
    const channels = [];
    let nextKey;
    do {
        throwIfAborted(signal);
        const url = nextKey
            ? `${config.localOsmosisRestEndpoint}${QUERY_ALL_CHANNELS_URL}&pagination.key=${encodeURIComponent(nextKey)}`
            : `${config.localOsmosisRestEndpoint}${QUERY_ALL_CHANNELS_URL}`;
        const data = await fetchJson(url, config.fetchImpl, signal).catch(() => {
            throwIfAborted(signal);
            return { channels: [] };
        });
        for (const channel of data.channels || []) {
            throwIfAborted(signal);
            if (!isOpenChannelState(channel.state)) {
                continue;
            }
            const clientState = await fetchClientStateFromChannel(config.localOsmosisRestEndpoint, channel.channel_id, channel.port_id, config.fetchImpl, signal).catch(() => {
                throwIfAborted(signal);
                return null;
            });
            if (clientState?.identified_client_state?.client_state?.chain_id ===
                config.cardanoChainId) {
                channels.push(channel);
            }
        }
        nextKey = data.pagination?.next_key;
    } while (nextKey);
    return channels;
}
async function fetchClientStateFromChannel(restUrl, channelId, portId, fetchImpl, signal) {
    return fetchJson(`${restUrl}${QUERY_CHANNELS_PREFIX_URL}/${channelId}/ports/${portId}/client_state`, fetchImpl, signal);
}
function selectLatestChannel(channels) {
    return channels.reduce((selected, channel) => {
        if (!selected)
            return channel;
        return compareChannelId(channel.channel_id, selected.channel_id) > 0
            ? channel
            : selected;
    }, undefined);
}
function compareChannelId(a, b) {
    const aSequence = parseChannelSequence(a);
    const bSequence = parseChannelSequence(b);
    if (aSequence !== undefined && bSequence !== undefined) {
        return aSequence === bSequence ? 0 : aSequence > bSequence ? 1 : -1;
    }
    return a.localeCompare(b);
}
function parseChannelSequence(channelId) {
    const match = /^channel-(\d+)$/.exec(channelId);
    return match ? BigInt(match[1]) : undefined;
}
async function fetchCrossChainSwapRouterState(config) {
    if (!config.swapRouterAddress) {
        return [];
    }
    const url = `${config.localOsmosisRestEndpoint}${QUERY_SWAP_ROUTER_STATE.replace('SWAP_ROUTER_ADDRESS', config.swapRouterAddress)}`;
    const data = await fetchJson(url, config.fetchImpl).catch(() => ({ models: [] }));
    const routes = [];
    for (const model of data.models || []) {
        let keyText = hexToAscii(model.key);
        if (!keyText.startsWith(SWAP_ROUTING_TABLE_PREFIX)) {
            continue;
        }
        keyText = keyText.replace(SWAP_ROUTING_TABLE_PREFIX, '');
        const route = decodeBase64Json(model.value);
        const lastPool = route[route.length - 1];
        if (!lastPool?.token_out_denom) {
            continue;
        }
        const outToken = lastPool.token_out_denom;
        const inToken = keyText.replace(outToken, '');
        if (inToken) {
            routes.push({ route, inToken, outToken });
        }
    }
    return routes;
}
async function estimateSwapViaRest(config, tokenInAmount, tokenInDenom, routes) {
    const [firstRoute] = routes;
    if (!firstRoute) {
        return {
            message: 'Cannot find swap route for the selected token pair.',
            tokenOutAmount: BIGINT_ZERO,
            tokenSwapAmount: BIGINT_ZERO,
        };
    }
    const url = new URL(`${config.localOsmosisRestEndpoint}/osmosis/poolmanager/v1beta1/${firstRoute.pool_id}/estimate/swap_exact_amount_in_with_primitive_types`);
    url.searchParams.set('token_in', `${tokenInAmount}${tokenInDenom}`);
    for (const route of routes) {
        url.searchParams.append('routes_pool_id', route.pool_id);
        url.searchParams.append('routes_token_out_denom', route.token_out_denom);
    }
    try {
        const response = await fetchJson(url.toString(), config.fetchImpl);
        return {
            message: '',
            tokenOutAmount: BigInt(response.token_out_amount || '0'),
            tokenSwapAmount: BigInt(tokenInAmount),
        };
    }
    catch (error) {
        return {
            message: error instanceof Error
                ? error.message
                : 'Failed to estimate swap output.',
            tokenOutAmount: BIGINT_ZERO,
            tokenSwapAmount: BigInt(tokenInAmount),
        };
    }
}
function buildEmptyEstimate(message) {
    return {
        message,
        tokenOutAmount: '0',
        tokenOutTransferBackAmount: '0',
        tokenSwapAmount: '0',
        outToken: null,
        transferRoutes: [],
        transferBackRoutes: [],
        transferChains: [],
    };
}
function isOpenChannelState(state) {
    return state === 'STATE_OPEN' || state === 'OPEN' || state === 'Open' || state === 3 || state === '3';
}
async function fetchJson(url, fetchImpl, signal) {
    throwIfAborted(signal);
    const response = await fetchImpl(url, signal ? { signal } : undefined);
    throwIfAborted(signal);
    if (!response.ok) {
        throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json());
    throwIfAborted(signal);
    return data;
}
function throwIfAborted(signal) {
    if (!signal?.aborted) {
        return;
    }
    if (signal.reason instanceof Error) {
        throw signal.reason;
    }
    throw new Error('IBC route discovery was aborted.');
}
function hexToAscii(hexInput) {
    let output = '';
    for (let index = 0; index < hexInput.length; index += 2) {
        output += String.fromCharCode(Number.parseInt(hexInput.slice(index, index + 2), 16));
    }
    return output;
}
function decodeBase64Json(value) {
    if (typeof atob === 'function') {
        return JSON.parse(atob(value));
    }
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
}
