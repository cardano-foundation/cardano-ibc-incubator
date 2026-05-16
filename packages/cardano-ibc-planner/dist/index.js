"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlannerClient = createPlannerClient;
const DIRECT_ROUTE_UNSUPPORTED = 'Direct Cardano-to-target IBC routes are not implemented yet.';
function createPlannerClient(config) {
    return {
        async planTransferRoute(request) {
            if (!request.fromChainId || !request.toChainId || !request.tokenDenom) {
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
            if (request.fromChainId === request.toChainId) {
                return {
                    foundRoute: true,
                    mode: 'same-chain',
                    chains: [request.fromChainId],
                    routes: [],
                    tokenTrace: {
                        kind: 'native',
                        path: '',
                        baseDenom: request.tokenDenom,
                        fullDenom: request.tokenDenom,
                    },
                };
            }
            return {
                foundRoute: false,
                mode: null,
                chains: [request.fromChainId, request.toChainId],
                routes: [],
                tokenTrace: null,
                failureCode: 'direct-route-unsupported',
                failureMessage: `${DIRECT_ROUTE_UNSUPPORTED} The former intermediary-chain route has been phased out.`,
                routeDiagnostics: {
                    expectedChainPath: request.expectedChainPath || [
                        request.fromChainId,
                        request.toChainId,
                    ],
                    missingHops: [
                        {
                            fromChainId: request.fromChainId,
                            toChainId: request.toChainId,
                            reason: 'no-channel-to-destination',
                            availableDestChainIds: [],
                        },
                    ],
                },
            };
        },
        async getLocalOsmosisSwapOptions() {
            return {
                from_chain_id: config.cardanoChainId,
                from_chain_name: 'Cardano',
                to_chain_id: 'localosmosis',
                to_chain_name: 'Local Osmosis',
                to_tokens: [],
            };
        },
        async estimateLocalOsmosisSwap() {
            return {
                message: `${DIRECT_ROUTE_UNSUPPORTED} Swap estimation is disabled until direct routes exist.`,
                tokenOutAmount: '0',
                tokenOutTransferBackAmount: '0',
                tokenSwapAmount: '0',
                outToken: null,
                transferRoutes: [],
                transferBackRoutes: [],
                transferChains: [],
            };
        },
    };
}
