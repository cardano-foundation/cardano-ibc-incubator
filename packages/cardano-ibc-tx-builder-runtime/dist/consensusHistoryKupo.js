"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKupoConsensusHistoryReader = createKupoConsensusHistoryReader;
const lucid_1 = require("@lucid-evolution/lucid");
const consensusHistory_1 = require("./consensusHistory");
const plutusSerialise_1 = require("./plutusSerialise");
function fields(value, count) {
    if (!(value instanceof lucid_1.Constr) || value.index !== 0 || value.fields.length !== count) {
        throw new Error('Invalid production client datum in Kupo history');
    }
    return value.fields;
}
function entry(value) {
    if (!(value instanceof Map) || value.size !== 1)
        throw new Error('Historical client must contain one checkpoint');
    return [...value.entries()][0];
}
/** Public leaves only. The caller must authenticate the complete rebuilt HostState root. */
function createKupoConsensusHistoryReader(endpoint, options = {}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const headers = { ...options.headers, accept: 'application/json;asset-quantity=string' };
    const get = async (path) => {
        const response = await fetchImpl(`${endpoint.replace(/\/$/, '')}/${path}`, {
            headers,
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok)
            throw new Error(`Kupo consensus history request failed (${response.status})`);
        return response.json();
    };
    return async (client) => {
        if (!client.datum || !client.address)
            throw new Error('Client output is missing its datum or address');
        const [currentState, token] = fields(lucid_1.Data.from(client.datum), 3);
        const [policy, name] = fields(token, 2);
        if (typeof policy !== 'string' || typeof name !== 'string')
            throw new Error('Invalid client authentication token');
        const unit = policy + name;
        if (client.assets[unit] !== 1n)
            throw new Error('Client authentication token is missing');
        const [latestHeight] = entry(fields(currentState, 4)[1]);
        const latestKey = lucid_1.Data.to(latestHeight, undefined, { canonical: true });
        // Kupo v2.9 orders same-slot outputs by their actual transaction index.
        // Do not use ?unspent: the earlier checkpoint outputs have been consumed.
        const response = await get(`matches/${policy}.${name}?order=oldest_first`);
        if (!Array.isArray(response))
            throw new Error('Invalid Kupo consensus history response');
        const matches = response;
        const records = new Map();
        const refs = new Set();
        let previous;
        let foundCurrent = false;
        for (const match of matches) {
            const point = match.created_at;
            if (!point || !Number.isSafeInteger(point.slot_no) || point.slot_no < 0 ||
                !Number.isSafeInteger(match.transaction_index) || match.transaction_index < 0 ||
                !Number.isSafeInteger(match.output_index) || match.output_index < 0 ||
                !/^[0-9a-f]{64}$/.test(match.transaction_id) || !/^[0-9a-f]{64}$/.test(point.header_hash)) {
                throw new Error('Kupo history is missing a canonical transaction position');
            }
            if (previous && (point.slot_no < previous.created_at.slot_no ||
                (point.slot_no === previous.created_at.slot_no &&
                    (point.header_hash !== previous.created_at.header_hash || match.transaction_index <= previous.transaction_index)))) {
                throw new Error('Kupo consensus history is unordered or contains conflicting chain points');
            }
            previous = match;
            const ref = `${match.transaction_id}#${match.output_index}`;
            if (refs.has(ref))
                throw new Error('Duplicate client output in Kupo history');
            refs.add(ref);
            if (foundCurrent)
                continue;
            const quantity = match.value?.assets?.[`${policy}.${name}`] ?? match.value?.assets?.[unit];
            if (match.address !== client.address || (quantity !== '1' && quantity !== 1) ||
                !match.datum_hash || match.datum_type !== 'inline') {
                throw new Error('Kupo history contains an unauthenticated client output');
            }
            const datum = await get(`datums/${match.datum_hash}`);
            if (!datum || typeof datum.datum !== 'string')
                throw new Error('Kupo has pruned a required historical client datum');
            const [state, historicalToken] = fields(lucid_1.Data.from(datum.datum), 3);
            const [historicalPolicy, historicalName] = fields(historicalToken, 2);
            if (historicalPolicy !== policy || historicalName !== name)
                throw new Error('Historical client token does not match');
            const [, consensus, times, heights] = fields(state, 4);
            const [height, consensusState] = entry(consensus);
            const [timeKey, time] = entry(times);
            const [heightKey, processedHeight] = entry(heights);
            const key = lucid_1.Data.to(height, undefined, { canonical: true });
            if (key !== lucid_1.Data.to(timeKey, undefined, { canonical: true }) || key !== lucid_1.Data.to(heightKey, undefined, { canonical: true })) {
                throw new Error('Historical checkpoint processing metadata is misaligned');
            }
            const record = (0, consensusHistory_1.recordFromConstr)(new lucid_1.Constr(0, [historicalToken, height, consensusState, time, processedHeight]));
            // A freeze may republish the same checkpoint with different CBOR container
            // forms. Its public consensus leaf remains the first accepted value.
            if (!records.has(key))
                records.set(key, {
                    datum: {
                        ...record,
                        consensusState: {
                            timestamp: record.consensusState.timestamp,
                            next_validators_hash: record.consensusState.nextValidatorsHash,
                            root: { hash: record.consensusState.root },
                        },
                    },
                    consensusValue: (0, plutusSerialise_1.publicClientCommitmentValues)(datum.datum, 'production').consensusValue,
                    archived: key !== latestKey,
                });
            if (match.transaction_id === client.txHash && match.output_index === client.outputIndex) {
                if (datum.datum !== client.datum)
                    throw new Error('Kupo current client datum differs from the live input');
                foundCurrent = true;
            }
        }
        if (!foundCurrent)
            throw new Error('Kupo consensus history has not reached the live client output');
        return [...records.values()];
    };
}
