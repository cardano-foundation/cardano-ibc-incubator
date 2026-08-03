"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteDiscoveryTimeoutError = exports.DEFAULT_ROUTE_DISCOVERY_TIMEOUT_MS = void 0;
exports.createPlannerClient = createPlannerClient;
const LOCAL_OSMOSIS_CHAIN_ID = 'localosmosis';
const QUERY_CHANNELS_PREFIX_URL = '/ibc/core/channel/v1/channels';
const QUERY_ALL_CHANNELS_URL = `${QUERY_CHANNELS_PREFIX_URL}?pagination.count_total=true&pagination.limit=10000`;
const QUERY_CARDANO_CHANNELS_URL = '/api/cardano/channel-ends?key=&offset=0&limit=10000&countTotal=true&reverse=false';
const QUERY_LEGACY_CARDANO_CHANNELS_URL = '/api/channels?key=&offset=0&limit=10000&countTotal=true&reverse=false';
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
class RouteDiscoveryHttpError extends Error {
    status;
    constructor(url, response) {
        super(`Request failed for ${url}: ${response.status} ${response.statusText}`);
        this.name = 'RouteDiscoveryHttpError';
        this.status = response.status;
    }
}
class RouteDiscoveryResponseError extends Error {
    constructor(url, detail) {
        super(`Invalid route discovery response from ${url}: ${detail}`);
        this.name = 'RouteDiscoveryResponseError';
    }
}
function normalizeRouteDiscoveryTimeoutMs(timeoutMs) {
    return typeof timeoutMs === 'number' &&
        Number.isFinite(timeoutMs) &&
        timeoutMs > 0
        ? timeoutMs
        : exports.DEFAULT_ROUTE_DISCOVERY_TIMEOUT_MS;
}
async function withRouteDiscoveryTimeout(operation, timeoutMs, externalSignal) {
    const controller = new AbortController();
    let timeoutId;
    let removeExternalAbortListener;
    const timeoutError = new RouteDiscoveryTimeoutError(timeoutMs);
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort(timeoutError);
            reject(timeoutError);
        }, timeoutMs);
    });
    const operations = [
        Promise.resolve().then(() => operation(controller.signal)),
        timeout,
    ];
    if (externalSignal) {
        operations.push(new Promise((_, reject) => {
            const abort = () => {
                const abortError = new Error('IBC route discovery was cancelled.');
                abortError.name = 'RouteDiscoveryAbortedError';
                controller.abort(abortError);
                reject(abortError);
            };
            if (externalSignal.aborted) {
                abort();
                return;
            }
            externalSignal.addEventListener('abort', abort, { once: true });
            removeExternalAbortListener = () => externalSignal.removeEventListener('abort', abort);
        }));
    }
    try {
        return await Promise.race(operations);
    }
    finally {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
        removeExternalAbortListener?.();
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
        async checkTransferRouteAvailability(request) {
            const fromChainId = request.fromChainId.trim();
            const toChainId = request.toChainId.trim();
            const chains = [fromChainId, toChainId].filter(Boolean);
            if (!fromChainId || !toChainId) {
                return {
                    status: 'unknown',
                    chains,
                    routes: [],
                    failureCode: 'invalid-request',
                    failureMessage: 'fromChainId and toChainId are required.',
                };
            }
            if (fromChainId === toChainId) {
                return {
                    status: 'available',
                    chains: [fromChainId],
                    routes: [],
                };
            }
            const isCardanoToCounterparty = fromChainId === resolvedConfig.cardanoChainId &&
                toChainId === resolvedConfig.counterpartyChainId;
            const isCounterpartyToCardano = fromChainId === resolvedConfig.counterpartyChainId &&
                toChainId === resolvedConfig.cardanoChainId;
            if (!isCardanoToCounterparty && !isCounterpartyToCardano) {
                return {
                    status: 'unavailable',
                    chains,
                    routes: [],
                    failureCode: 'unsupported-route',
                    failureMessage: `No configured direct transfer route exists from ${fromChainId} to ${toChainId}.`,
                };
            }
            if (!resolvedConfig.cardanoRestEndpoint?.trim()) {
                return {
                    status: 'unknown',
                    chains,
                    routes: [],
                    failureCode: 'discovery-failed',
                    failureMessage: 'A Cardano channel endpoint is required to verify both ends of the IBC channel pair.',
                };
            }
            try {
                const directPair = await withRouteDiscoveryTimeout((signal) => fetchDirectChannelPair(resolvedConfig, signal), resolvedConfig.routeDiscoveryTimeoutMs, request.signal);
                if (!directPair) {
                    return {
                        status: 'unavailable',
                        chains,
                        routes: [],
                        failureCode: 'no-open-channel',
                        failureMessage: `No mutually open IBC transfer channel pair exists from ${fromChainId} to ${toChainId}.`,
                    };
                }
                return {
                    status: 'available',
                    chains,
                    routes: [
                        `transfer/${isCardanoToCounterparty
                            ? directPair.cardanoChannel
                            : directPair.counterpartyChannel}`,
                    ],
                };
            }
            catch (error) {
                const failureCode = error instanceof RouteDiscoveryTimeoutError
                    ? 'discovery-timeout'
                    : error instanceof Error &&
                        error.name === 'RouteDiscoveryAbortedError'
                        ? 'discovery-aborted'
                        : 'discovery-failed';
                const detail = error instanceof Error && error.message.trim()
                    ? error.message
                    : 'The route discovery endpoints did not return a usable response.';
                return {
                    status: 'unknown',
                    chains,
                    routes: [],
                    failureCode,
                    failureMessage: failureCode === 'discovery-timeout' ||
                        failureCode === 'discovery-aborted'
                        ? detail
                        : `Unable to verify IBC route availability. ${detail}`,
                };
            }
        },
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
            const isCardanoToCounterparty = fromChainId === resolvedConfig.cardanoChainId &&
                toChainId === resolvedConfig.counterpartyChainId;
            const isCounterpartyToCardano = fromChainId === resolvedConfig.counterpartyChainId &&
                toChainId === resolvedConfig.cardanoChainId;
            if (!isCardanoToCounterparty && !isCounterpartyToCardano) {
                return noDirectRoute(fromChainId, toChainId, request.expectedChainPath);
            }
            const directPair = await withRouteDiscoveryTimeout((signal) => fetchDirectChannelPair(resolvedConfig, signal), resolvedConfig.routeDiscoveryTimeoutMs);
            if (isCardanoToCounterparty) {
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
            if (isCounterpartyToCardano) {
                if (!directPair) {
                    return noDirectRoute(fromChainId, toChainId, request.expectedChainPath);
                }
                return {
                    foundRoute: true,
                    mode: 'native-forward',
                    chains: [fromChainId, toChainId],
                    routes: [`transfer/${directPair.counterpartyChannel}`],
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
            let directPair;
            try {
                directPair = await withRouteDiscoveryTimeout((signal) => fetchDirectChannelPair(resolvedConfig, signal), resolvedConfig.routeDiscoveryTimeoutMs);
            }
            catch (error) {
                return buildEmptyEstimate(error instanceof Error
                    ? `Unable to verify the Cardano-to-Osmosis transfer channel. ${error.message}`
                    : 'Unable to verify the Cardano-to-Osmosis transfer channel.');
            }
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
                transferBackRoutes: [`transfer/${directPair.counterpartyChannel}`],
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
async function fetchDirectChannelPair(config, signal) {
    if (config.cardanoRestEndpoint?.trim()) {
        const channels = await fetchOpenCardanoChannels(config, signal);
        const candidates = [...channels].sort((a, b) => compareChannelId(b.channel_id, a.channel_id));
        let firstQueryError;
        for (const candidate of candidates) {
            throwIfAborted(signal);
            try {
                if (await isMatchingOpenCounterpartyChannel(config, candidate, signal)) {
                    return {
                        cardanoChannel: candidate.channel_id,
                        counterpartyChannel: candidate.counterparty.channel_id,
                    };
                }
            }
            catch (error) {
                throwIfAborted(signal);
                firstQueryError ??= error;
            }
        }
        if (firstQueryError) {
            throw firstQueryError;
        }
        return null;
    }
    const channels = await fetchOpenCounterpartyChannels(config, signal);
    const selected = selectLatestChannel(channels);
    return selected
        ? {
            cardanoChannel: selected.counterparty.channel_id,
            counterpartyChannel: selected.channel_id,
        }
        : null;
}
async function fetchOpenCardanoChannels(config, signal) {
    throwIfAborted(signal);
    const restEndpoint = config.cardanoRestEndpoint.trim().replace(/\/+$/, '');
    let url = `${restEndpoint}${QUERY_CARDANO_CHANNELS_URL}`;
    let data;
    try {
        data = await fetchJson(url, config.fetchImpl, signal);
    }
    catch (error) {
        throwIfAborted(signal);
        if (!(error instanceof RouteDiscoveryHttpError) || error.status !== 404) {
            throw error;
        }
        url = `${restEndpoint}${QUERY_LEGACY_CARDANO_CHANNELS_URL}`;
        data = await fetchJson(url, config.fetchImpl, signal);
    }
    return parseChannelList(data.channels, url).filter(isOpenTransferChannel);
}
async function isMatchingOpenCounterpartyChannel(config, cardanoChannel, signal) {
    const restEndpoint = config.localOsmosisRestEndpoint.trim().replace(/\/+$/, '');
    const channelId = encodeURIComponent(cardanoChannel.counterparty.channel_id);
    const portId = encodeURIComponent(cardanoChannel.counterparty.port_id);
    const url = `${restEndpoint}${QUERY_CHANNELS_PREFIX_URL}/${channelId}/ports/${portId}`;
    let data;
    try {
        data = await fetchJson(url, config.fetchImpl, signal);
    }
    catch (error) {
        throwIfAborted(signal);
        if (error instanceof RouteDiscoveryHttpError && error.status === 404) {
            return false;
        }
        throw error;
    }
    const channel = parseCounterpartyChannel(data.channel, url);
    return Boolean(isOpenChannelState(channel.state) &&
        channel.counterparty.channel_id === cardanoChannel.channel_id &&
        channel.counterparty.port_id === cardanoChannel.port_id);
}
async function fetchOpenCounterpartyChannels(config, signal) {
    const channels = [];
    let firstQueryError;
    let nextKey;
    do {
        throwIfAborted(signal);
        const url = nextKey
            ? `${config.localOsmosisRestEndpoint}${QUERY_ALL_CHANNELS_URL}&pagination.key=${encodeURIComponent(nextKey)}`
            : `${config.localOsmosisRestEndpoint}${QUERY_ALL_CHANNELS_URL}`;
        const data = await fetchJson(url, config.fetchImpl, signal);
        for (const channel of parseChannelList(data.channels, url)) {
            throwIfAborted(signal);
            if (!isOpenTransferChannel(channel)) {
                continue;
            }
            try {
                const clientState = await fetchClientStateFromChannel(config.localOsmosisRestEndpoint, channel.channel_id, channel.port_id, config.fetchImpl, signal);
                const clientChainId = clientState?.identified_client_state?.client_state?.chain_id;
                if (!clientChainId) {
                    throw new RouteDiscoveryResponseError(`${config.localOsmosisRestEndpoint}${QUERY_CHANNELS_PREFIX_URL}/${channel.channel_id}/ports/${channel.port_id}/client_state`, 'identified client chain_id is required.');
                }
                if (clientChainId === config.cardanoChainId) {
                    channels.push(channel);
                }
            }
            catch (error) {
                throwIfAborted(signal);
                firstQueryError ??= error;
            }
        }
        nextKey = data.pagination?.next_key;
    } while (nextKey);
    if (channels.length === 0 && firstQueryError) {
        throw firstQueryError;
    }
    return channels;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseChannelList(value, url) {
    if (!Array.isArray(value)) {
        throw new RouteDiscoveryResponseError(url, 'channels must be an array.');
    }
    return value.map((candidate, index) => {
        const counterparty = isRecord(candidate) ? candidate.counterparty : null;
        const state = isRecord(candidate) ? candidate.state : undefined;
        if (!isRecord(candidate) ||
            typeof candidate.channel_id !== 'string' ||
            typeof candidate.port_id !== 'string' ||
            (typeof state !== 'string' && typeof state !== 'number') ||
            !isRecord(counterparty) ||
            typeof counterparty.channel_id !== 'string' ||
            typeof counterparty.port_id !== 'string') {
            throw new RouteDiscoveryResponseError(url, `channels[${index}] is missing a channel id, port, state, or counterparty.`);
        }
        return {
            channel_id: candidate.channel_id,
            port_id: candidate.port_id,
            state,
            counterparty: {
                channel_id: counterparty.channel_id,
                port_id: counterparty.port_id,
            },
        };
    });
}
function parseCounterpartyChannel(value, url) {
    const counterparty = isRecord(value) ? value.counterparty : null;
    const state = isRecord(value) ? value.state : undefined;
    if (!isRecord(value) ||
        (typeof state !== 'string' && typeof state !== 'number') ||
        !isRecord(counterparty) ||
        typeof counterparty.channel_id !== 'string' ||
        typeof counterparty.port_id !== 'string') {
        throw new RouteDiscoveryResponseError(url, 'channel state and counterparty channel/port ids are required.');
    }
    return {
        state,
        counterparty: {
            channel_id: counterparty.channel_id,
            port_id: counterparty.port_id,
        },
    };
}
function isOpenTransferChannel(channel) {
    return (isOpenChannelState(channel.state) &&
        channel.port_id === 'transfer' &&
        channel.counterparty?.port_id === 'transfer' &&
        /^channel-\d+$/.test(channel.channel_id) &&
        /^channel-\d+$/.test(channel.counterparty.channel_id));
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
        throw new RouteDiscoveryHttpError(url, response);
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
