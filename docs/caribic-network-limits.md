# Caribic network limits

Caribic pins local capacity limits to dated public-network snapshots instead of
accepting the defaults produced by each chain binary. This keeps local tests
from succeeding only because a simulator permits larger transactions, blocks,
validator sets, or evidence than the network it represents.

The values below were checked on 2026-08-27. Public-network parameters can
change through governance. Updating a snapshot must be an explicit repository
change with corresponding test updates.

| Local profile               | Modeled network            | Block bytes |   Block gas | Maximum validators |  Hermes gas | Hermes transaction bytes |
| --------------------------- | -------------------------- | ----------: | ----------: | -----------------: | ----------: | -----------------------: |
| `injective-777`             | Injective mainnet          |   4,194,304 | 150,000,000 |                 45 |  75,000,000 |                1,000,000 |
| `v8-classic`, `v10-classic` | Injective mainnet envelope |   4,194,304 | 150,000,000 |                 45 |  75,000,000 |                1,000,000 |
| `v10-v2`                    | Injective mainnet envelope |   4,194,304 | 150,000,000 |                 45 |         N/A |                      N/A |
| `localosmosis`              | Osmosis mainnet            |   3,000,000 | 300,000,000 |                 70 | 300,000,000 |                1,000,000 |
| `cheqd-local`               | cheqd mainnet              |   3,000,000 |  30,000,000 |                125 |  30,000,000 |                1,000,000 |

| Modeled network | Evidence age in blocks | Evidence age | Evidence bytes |  Unbonding period | Historical entries |
| --------------- | ---------------------: | -----------: | -------------: | ----------------: | -----------------: |
| Injective       |                100,000 |     48 hours |      1,048,576 |           21 days |             10,000 |
| Osmosis         |                100,000 |     48 hours |      1,048,576 |           14 days |             10,000 |
| cheqd           |                 25,920 |     72 hours |          5,000 | 1,210,000 seconds |             10,000 |

Injective separately limits requested gas per transaction to 75,000,000, so
Hermes uses that value rather than the 150,000,000 block limit. The local
Osmosis and cheqd profiles model no lower per-transaction cap, so their Hermes
caps follow their block limits. All configured Hermes profiles retain a
conservative 1,000,000 byte limit, and every local Cosmos node uses a 1,048,576
byte mempool limit. Local RPC request bodies allow 4,000,000 bytes so JSON and
base64 framing around a one-megabyte binary transaction does not become the
effective limit. This is a node-local transport allowance, not a consensus
parameter.

The generic ibc-go v8 and v10 profiles copy Injective's capacity envelope
because Injective is their current target. They still run stock `simd`, use a
synthetic fee denomination, and create one validator. A `max_validators` value
of 45 limits possible active validators; it does not make a one-validator test
exercise a 45-validator header. Stock `simd` does not contain Injective's
`txfees` module, so the generic chains cannot enforce Injective's 75,000,000
per-transaction gas rule in their ante handler; the generated classic Hermes
profiles enforce that ceiling for relayed transactions. Caribic does not
configure Hermes for `v10-v2` because that profile is not classic-route
compatible.

Local Cardano uses the current mainnet numeric ceilings: 16,384 transaction
bytes, 90,112 block-body bytes, 16,500,000 transaction memory units,
10,000,000,000 transaction steps, 72,000,000 block memory units, and
20,000,000,000 block steps. The transaction-budget CI uses the same values and
keeps its existing 750-byte and 5% reserves.

The active local ledger source is
`chains/cardano/config/devnet/genesis-alonzo.json` together with the Shelley
genesis in that directory. `chains/cardano/config/protocol-parameters.json` is
not loaded by Caribic.

The local Cardano ledger is pinned to protocol version 10 and the repository
cost models. Protocol version 10 is required by the bitwise Plutus V3 builtins
used by the supported ICS-20 codecs. The numeric capacity is strict, but this
does not claim byte-for-byte protocol-version 11 execution parity. Full current
Cardano execution parity requires a coordinated cardano-node, Ogmios, Kupo,
Aiken, and cost-model upgrade.

Fast governance periods, deterministic clocks, local token balances, and fee
prices remain test settings. They are not transaction or validator capacity
limits. Cardano preprod/preview and other public profiles connect to live
networks, so Caribic does not rewrite their node or consensus configuration.
The public Injective and Osmosis Hermes profiles use the corresponding caps
listed above.

Genesis and generated-home changes apply only to a newly generated local
chain. The generic and Injective profiles reject a preserved genesis with
different limits; other saved chains may retain their prior ledger parameters.
Remove preserved state or start Caribic in clean/stateless mode after changing
branches.

The transaction-budget job checks representative transaction-budget scenarios
against the same Cardano limits. Seven scenarios currently have recorded
transaction-budget violations: reference-script deployment, SendPacket at
commitment capacity, RecvPacket at history capacity, PrunePacketHistory,
trace-registry rollover, the first-seen voucher component, and the combined
first-seen voucher receive path. RecvPacket now includes membership-proof
verification. The combined path also includes the transfer callback, voucher
policy, registry append with eight archived shards, six outputs, seven reference
scripts, and the maximum across the v8 and v10 512-byte packet fixtures and the
archive entry-count and encoded-byte bounds.
The v10 fixture is the struct-order late-match path after ibc-rs, and the v8
fixture is the sorted-order late-match path after Cardano. Paying for the failed
earlier candidate makes these two paths bound all four accepted wire profiles.

The CI size budget is 15,634 bytes: the 16,384-byte ledger maximum less a
750-byte reserve. Reference-script deployment has a 16,040-byte signed estimate,
so it is a headroom violation but remains below the ledger maximum. The combined
receive path's additive model estimates 20,615 unsigned bytes and 20,875 signed
bytes, which exceeds the ledger maximum. Actual balanced CBOR is not built here,
so this estimate is not a direct measurement of a submitted transaction. Its
96,763,049 memory units and 31,523,591,002 CPU steps also sum isolated Aiken
fixtures; they are not a ledger evaluation of every validator in one combined
transaction. Each recorded size or execution-unit overrun has an exact
regression ceiling. CI rejects any increase, requires the ceiling to be lowered
after any improvement, rejects unrecorded overruns, and requires stale ceilings
to be removed once a scenario fits. The three 45-validator UpdateClient
scenarios remain report-only and are not covered by this ratchet.

Sources:

- Cardano epoch 651 parameters: <https://api.koios.rest/api/v1/epoch_params?epoch_no=eq.651>
- Injective consensus parameters at height 180448981: <https://sentry.tm.injective.network/consensus_params?height=180448981>
- Injective staking parameters: <https://sentry.lcd.injective.network/cosmos/staking/v1beta1/params>
- Injective transaction-fee parameters: <https://sentry.lcd.injective.network/injective/txfees/v1beta1/params>
- Osmosis consensus parameters at height 69370437: <https://rpc.osmosis.zone/consensus_params?height=69370437>
- Osmosis staking parameters: <https://lcd.osmosis.zone/cosmos/staking/v1beta1/params>
- cheqd consensus parameters at height 25972518: <https://rpc.cheqd.net/consensus_params?height=25972518>
- cheqd staking parameters: <https://api.cheqd.net/cosmos/staking/v1beta1/params>
