The probabilistic client has one storage format. The native replay verifies bounded transactions against the pinned Injective application and captured destination limits. Historical reports under `evidence/` show why the removed inline implementation could not fit those limits. That implementation is no longer selectable or executable.

The snapshot format has a bounded execution replay. Its [recorded results](evidence/bounded-results.json) use the same pinned native `InjectiveApp` and captured gas parameters. A separate socket ABCI process executes the actual application with persistent stores and a controlled clock. The source CLI does not support standalone ABCI. This replay therefore does not measure public CometBFT inclusion or elapsed detection time. It uses seven days of source trust for the deliberately sparse synthetic Cardano history.

Prepare the native graph with the bounded helper target. `prepare.sh` still builds `injectived`. The bounded helper constructs that same native application for the controlled-clock replay.

```sh
INJECTIVE_PROBE_IMAGE=local/injective-bounded-verification \
INJECTIVE_PROBE_BUILDER_IMAGE=local/injective-bounded-verification-builder \
INJECTIVE_PROBE_HELPER_IMAGE=local/injective-bounded-verification-probe \
INJECTIVE_PROBE_TARGET=bounded-probe \
bash tests/injective-probabilistic-lifecycle/prepare.sh "$HOME/injective-bounded-build"

python3 tests/injective-probabilistic-lifecycle/run_bounded.py "$HOME/injective-bounded-size" --fixture size
python3 tests/injective-probabilistic-lifecycle/run_bounded.py "$HOME/injective-bounded-limit" --fixture limit
python3 tests/injective-probabilistic-lifecycle/run_bounded.py "$HOME/injective-bounded-small-proposal" --fixture limit --small-proposal
python3 tests/injective-probabilistic-lifecycle/run_bounded.py "$HOME/injective-bounded-combined" --fixture combined --small-proposal
python3 tests/injective-probabilistic-lifecycle/run_bounded.py "$HOME/injective-bounded-lifecycle" --fixture lifecycle
python3 tests/injective-probabilistic-lifecycle/run_bounded.py "$HOME/injective-bounded-lifecycle" --fixture lifecycle --resume
python3 tests/injective-probabilistic-lifecycle/run_bounded.py "$HOME/injective-session-discard" --fixture size --discard-attacks
```

The discard regression funds a second account and interleaves its signed discard attempts with every step of an honest challenge. It checks transaction admission and sends each attempt into a block to require rejection during consensus execution. Each attempt must fail without changing the persisted session. The challenger must finish and commit the freeze before the proposal's deadline. The driver then advances the controlled host clock past the sessions' expiry. The second account must be able to discard an abandoned session and clean up the expired challenge session while the subject client is frozen. `bounded-session-discard-result.json` records the two accounts and the committed results.

The [captured run](evidence/session-discard-results.json) rejected all 131 discard attempts during admission and block execution. The honest freeze committed with 40,530 seconds left before the deadline. Both expired cleanup transactions then committed under the second account.

The size and near-limit observations now admit their proposals and commit honest challenges on the resulting state. One case gives the proposal 13 pool rows and the alternative 4,000 rows. Including the approximately 80 KiB body case, their largest signed transaction is 83,360 bytes. Peak execution is about 2.48 million gas. The largest requested allowance is about 4.45 million gas after the `1.8` multiplier. Their public client is 531 bytes and the final receipt challenge uses about 161,000 execution gas. These are measurements of these fixtures rather than worst-case certification for every supported mutation pattern.

The lifecycle opens a channel and receives a packet. It then commits the proposal and challenge, rejects frozen proof use and rejects unauthorized recovery. Expedited governance approves the replacement. The bounded recovery continuation installs generation `2`. Early proof use fails. Proofs at a genuinely accepted height from the discarded generation still fail after the fresh window. Subsequent packets produce 300 voucher units and three successful acknowledgements. Restart checks the persisted client and those acknowledgements.

The [single-format regression](evidence/single-format-results.json) reran the two-account scenario after removing inline storage. The honest challenge completed and froze the client 40,530 seconds before its deadline. All 131 active-session discard attempts were rejected. Expired discard and cleanup remained permissionless.

Client creation has a separate native replay that consumes the actual protobuf responses from Gateway's 4,000-row initialization test. It starts with no IBC client in genesis. Every signed `MsgCreateClient` and bounded `MsgUpdateClient` passes simulation, CheckTx, ReCheckTx and committed execution. The application restarts after sixteen imports and resumes the same client from its saved cursor. The replay uses the captured destination gas limits and a controlled ABCI clock. It does not exercise a live Hermes connection or CometBFT inclusion.

The [recorded creation replay](evidence/client-initialization-results.json) committed creation and all 992 imports. The signed creation transaction was 2,562 bytes. The largest transaction was 8,012 bytes and peak execution was 1,129,587 gas. The client finished with `bootstrap_pending = false` and status `Active`.

After building the Gateway dependencies and preparing the native builder above, run:

```sh
CLIENT_INITIALIZATION_FIXTURE=/tmp/cardano-client-initialization.pb.json \
  npm --prefix cardano/gateway test -- --runTestsByPath src/query/test/client-initialization.spec.ts
docker build --build-context probe_src=tests/injective-probabilistic-lifecycle/probe \
  -f tests/injective-probabilistic-lifecycle/Dockerfile.initialization \
  -t local/injective-client-initialization .
python3 tests/injective-probabilistic-lifecycle/run_initialization.py \
  /tmp/cardano-client-initialization.pb.json /tmp/cardano-client-creation-results
```

The runner creates its own Docker volume and containers. It copies the evidence to the requested fresh output directory and removes those Docker resources when it finishes.
