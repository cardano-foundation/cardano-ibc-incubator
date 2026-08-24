# Probabilistic Client Recovery

Substitute-client recovery repairs a non-active `08-cardano-probabilistic`
client without changing the client identifier used by an existing connection.
The expired or frozen client is the **subject**. A second, active client is the
**substitute** and supplies the trusted state used to recover it.

Recovery is not route migration. After a successful recovery, the original
subject client ID remains on the connection, and the connection, channel,
packet state, transfer escrow, and ICS-20 voucher denomination remain in place.
The substitute is not installed on the connection.

## Compatibility boundary

The subject and substitute must use the same concrete protobuf client type and
must agree on every field that defines the Cardano verification environment:

- upgrade path;
- HostState NFT policy ID and token name;
- Cardano system start and slot length;
- slots per KES period and maximum KES evolutions.

The substitute's Cardano checkpoint must be strictly newer than the subject's
checkpoint. Its latest consensus state, processed time, and processed height
must exist and be valid, and its checkpoint cursor must agree with that state.
Operational-certificate counters may not move backwards.

These checks mean recovery cannot cross from another protobuf client type, and
it cannot move a route to a replacement Cardano deployment with a different
HostState NFT. Those cases require a new client and route or a separately
designed migration.

On success, the implementation copies the substitute's latest consensus state
and its processed-time, processed-height, and consensus-iteration metadata to
the subject. It advances the subject's latest height, chain ID, and trusting
period, and installs the substitute's checkpoint cursor, retained epoch
contexts, current epoch fields, and operational-certificate counter snapshot.
The old operational-certificate rollback history is discarded and starts again
at the recovered checkpoint. The per-height score, unique-pool, unique-stake,
and accepted-hash keys are diagnostic only; verification uses the copied
consensus state, and later ordinary updates write fresh diagnostics.

## Local end-to-end test

The focused test requires a disposable local Cardano stack and a newly created
Classic Cosmos profile. Do not use `--chain-flag stateful=true`: a retained
profile can contain a reusable connection or channel backed by the wrong
subject, and its genesis may not contain the short governance periods used by
the test.

Build and install the repository's current `caribic` and Hermes binaries, then
start a clean stack and one Classic profile:

```sh
caribic start --clean
caribic chain start --chain cosmos --network v8-classic
caribic health-check
caribic test --light-client recover-client \
  --chain cosmos \
  --network v8-classic
```

`--light-client` without a value selects `recover-client`, and omitting the
chain and network selects `cosmos` and `v8-classic`. Use a fresh stack and
replace `v8-classic` with `v10-classic` to exercise the equivalent ibc-go v10
Classic path:

```sh
caribic test --light-client --chain cosmos --network v10-classic
```

`v8-classic` and `v10-classic` exercise the same IBC Classic recovery semantics
through their version-specific APIs. `v10-v2` is rejected because the Cardano
and Hermes IBC v2 route adapter is deferred.

The test owns packet delivery while it runs. It stops the Hermes daemon if the
daemon was already running and restarts it afterward. It also temporarily
changes the Gateway's client trusting period and recreates the Gateway, then
attempts to restore the previous setting even when the scenario fails. Do not
run this command against a shared or public environment.

Let the command finish so normal cleanup can run. A process-level
`SIGINT`/`SIGTERM` can bypass that cleanup. After a forced interruption, restore
`CARDANO_CLIENT_TRUSTING_PERIOD_SECONDS` in `cardano/gateway/.env` (the standard
local value is `315360000`), run
`docker compose -f cardano/gateway/docker-compose.yml up -d --force-recreate app`,
and restart Hermes with `caribic start relayer --network local`.

### Required happy path

The scenario must fail unless all of these observations hold:

1. It creates a short-lived probabilistic subject, opens a connection and an
   ICS-20 channel that use that exact subject, and records the client,
   connection, and channel identifiers.
2. It creates an active, normal-lived substitute with matching recovery
   invariants.
3. It relays and acknowledges a packet over the new route before recovery and
   records the resulting Cosmos voucher balance and denomination trace.
4. It updates only the substitute until its Cardano checkpoint is strictly
   newer, then submits a short-timeout Cosmos-to-Cardano packet without relaying
   it. The pre-recovery snapshot includes that live commitment, the channel
   ends, Cosmos next-send and next-receive counters, commitment sequence lists
   on both chains, and the exact Cosmos sender and channel-escrow balances.
5. It leaves the subject untouched until ibc-go reports it as `Expired`. The
   test must not write a frozen height or submit fabricated misbehaviour to make
   an active client recoverable.
6. It submits `MsgRecoverClient` through the simapp's real IBC governance
   proposal command, deposits and votes, waits for the proposal to pass, and
   checks the proposal execution result.
7. It queries the original subject ID and requires it to be active. It also
   requires the original connection and channel IDs to remain open and all
   pre-recovery packet, escrow, and Cosmos voucher snapshots to remain unchanged.
8. It sends a Cardano-to-Cosmos packet and uses that packet's proof height to
   submit the first ordinary root-bearing probabilistic header to the recovered
   subject ID before relaying its membership proof.
9. It relays the pending packet's Cardano non-receipt proof back to Cosmos after
   its timeout. This exercises non-membership verification through the recovered
   subject and requires the Cosmos sender and channel escrow to return to their
   exact pre-packet balances.

Natural expiry is part of the assertion, not merely a delay. The subject must
remain active while its route is created and the pre-recovery packet is
relayed, and the test must observe the transition from `Active` to `Expired`
after updates stop. The trusting period must account for any difference between
the local Cardano and Cosmos clocks and leave enough time for connection and
channel setup.

The focused command covers the live positive path. The repository's v8 and v10
Go tests assert the store-state copy and reconstruction rules described above,
all seven invariant mismatches, an insufficient checkpoint, missing consensus
metadata, and operational-certificate regression. The active-subject,
inactive-substitute, concrete-type, and unauthorized-signer gates are enforced
by the ibc-go keeper/authority layer; dedicated app-level fixtures for those
negative paths remain follow-up coverage rather than claims made by this local
command.

The timeout leg directly checks its Cosmos-side channel escrow. The local
command does not independently locate and compare the Cardano escrow UTxO for
the Cardano-to-Cosmos transfers. Its unchanged route and packet snapshots
provide protocol continuity, but an operator must inventory Cardano escrow
explicitly as part of the production preflight below.

## Injective operator runbook

Treat public-chain recovery as a coordinated governance operation. The local
command above is a compatibility test, not an Injective automation command.
Confirm the exact governance flags, deposit, voting period, fees, and authority
with the deployed `injectived` version and the Injective operators before
submitting anything.

### Prepare and preflight

First establish the Injective binary's provenance with the Injective node
operators. Record the deployed `injectived version --long` result and source
commit, and verify that build contains the recovery-capable version of the
Cardano probabilistic light client, including its current recovery invariants
and store-state handling. Also query the IBC allowed-client parameters for
`08-cardano-probabilistic`. Registration in `allowed_clients` by itself does not
prove that the deployed binary contains the required recovery implementation.
If its provenance or capability cannot be confirmed, stop: a proposal cannot
install new light-client code, so Injective must first accept and deploy a node
release containing it.

Record the subject client ID, status, latest height, checkpoint, and concrete
type. Resolve every connection that refers to it, then record the connection
and channel IDs, channel states, packet sequences and outstanding commitments,
escrow balances, and voucher denomination traces. This snapshot is the basis
for both continuity checks and incident review.

Create the substitute against the same Cardano network and HostState
deployment. Compare all recovery-invariant fields listed above before funding a
proposal. Also verify its chain ID and trusting period because the recovered
subject adopts both values even though they are not part of the matching-field
projection. Keep the substitute updated with a dedicated relayer process and
verify repeatedly that it is active and its checkpoint remains strictly ahead
of the subject. Keep the route relayer stopped from updating the subject once a
genuine expiry is intended; otherwise it can make the subject active again and
cause proposal execution to fail.

Do not manufacture contradictory headers or set a frozen height merely to make
an active subject eligible. Misbehaviour is a security signal with operational
and governance consequences. Use recovery only after the subject has genuinely
expired or after independently established, real misbehaviour has frozen it.

### Submit through governance

Both supported ibc-go generations expose the proposal command in this form:

```sh
injectived tx ibc client recover-client \
  "$SUBJECT_CLIENT_ID" \
  "$SUBSTITUTE_CLIENT_ID" \
  --title "Recover Cardano probabilistic client" \
  --summary "Recover the existing client from the verified substitute" \
  --deposit "$DEPOSIT" \
  --from "$PROPOSER" \
  --chain-id "$INJECTIVE_CHAIN_ID" \
  <network-specific fee and node flags>
```

Use `injectived tx ibc client recover-client --help` from the exact node release
to validate the template. The command wraps `MsgRecoverClient` in a governance
proposal whose authority defaults to the governance module; a normal account
cannot bypass that authority by broadcasting the inner message directly.
Publish the subject/substitute comparison and the continuity snapshot with the
proposal so reviewers can check the operation before voting.

The affected Cardano route is unavailable for operations that require the
non-active subject until the proposal executes. Governance lead time is
therefore expected downtime. Continue updating the substitute throughout the
deposit and voting periods, and monitor both clients so the substitute cannot
expire before execution.

### Verify and resume

After the proposal passes, verify its execution event and query the original
subject ID. It must be `Active`, at the substitute's recovered height and
checkpoint, while every recorded connection and channel still names the
original subject and remains open. Compare packet sequences, outstanding
commitments, escrow, and denomination traces with the preflight snapshot before
resuming automatic packet relay.

Submit one ordinary probabilistic update to the original subject ID before
clearing the incident. Then relay a small Cardano-to-Injective packet to verify
membership and complete a controlled timeout of an Injective-to-Cardano packet
to verify non-membership. Confirm that existing vouchers keep the same denom
trace and that balances and escrow change only by the expected test amounts and
fees.

Proposal execution is atomic: a rejected recovery should leave the subject and
route unchanged. If execution or a post-check fails, keep packet relay stopped,
preserve both clients and the route, retain the active substitute, and compare
the chain events with the preflight snapshot. Correct the substitute or
proposal inputs and use a new governance proposal; do not delete the original
client or rebuild the channel as an improvised rollback.
