The larger local profile can accept a challenge that the public Injective profile cannot execute. This harness checks that difference with a separate `injectived` process. It uses Injective's `ethsecp256k1` key and `EthAccount` through the native CLI for signing and simulation. Broadcast results and committed transactions come from the node's RPC. The helper only prepares messages and explicitly trusted test genesis with the application's codecs.

The chosen source is `v1.18.0-1770939123` at `6632cef271f7482f39f9c5d4b085adc1370e8b7e`. The repository's patch script installs this branch's client without replacing Injective's SDK or IBC forks. The recorded binary uses Go `1.26.5` on Linux `arm64`. Its SHA-256 and resolved dependencies are in `evidence/binary-build-info.txt`. This is a rebuilt application with the release client. It is not the binary currently running on public Injective or a claim about an approved production build.

The captured testnet parameters come from `injective-888` at height `143753794` on October 14, 2026. The three LCD responses reported that same height. Testnet reported source version `v1.20.4-bl.2`. The capacity replay preserves its 75 million transaction gas limit and 150 million block gas limit. Blocks are limited to 4 MiB. The older chosen application rejects equal ordinary and expedited governance deposits. The genesis raises the expedited deposit by one wei and retains the captured 300-second expedited voting period. Other modules start from the chosen application's local genesis. Local transport settings allow 12 MiB transactions and 20,000,000-byte HTTP bodies so they cannot conceal a consensus or execution rejection. These transport settings are not a measurement of public RPC servers.

The capacity fixtures contain native signed Cardano headers and authenticated bodies. Their initial 4,000-pool registration registry is explicitly trusted test data. The lifecycle fixture has 13 pools and actual packet commitments for the Injective recipient. These fixtures exercise native verification but do not establish Cardano transaction or script validity. They are not a sample of mainnet stake or block traffic.

Use a fresh output directory shared with Docker. The preparation script builds the actual application and a helper from its resolved dependency graph. It also exports signed Cardano history containing the Injective recipient's packet commitments. Node databases and public test keys stay in that output directory. No transaction is sent to a public network.

```sh
bash tests/injective-probabilistic-lifecycle/prepare.sh "$HOME/injective-release-probe"
python3 tests/injective-probabilistic-lifecycle/run.py --output "$HOME/injective-release-probe" --profile testnet
python3 tests/injective-probabilistic-lifecycle/run.py --output "$HOME/injective-release-probe" --profile local --port 28658
python3 tests/injective-probabilistic-lifecycle/run.py --output "$HOME/injective-release-probe" --profile testnet --fixture size --port 28660
python3 tests/injective-probabilistic-lifecycle/run.py --output "$HOME/injective-release-probe" --profile local --fixture size --port 28661
python3 tests/injective-probabilistic-lifecycle/run.py --output "$HOME/injective-release-probe" --profile testnet --scenario lifecycle --port 28659
python3 tests/injective-probabilistic-lifecycle/export_evidence.py "$HOME/injective-release-probe" "$HOME/injective-release-probe/results.json"
```

The lifecycle opens a channel through signed transactions. It receives a packet and commits a conflicting-history challenge before the stored deadline. It checks that frozen state blocks packet proofs. An unauthorized recovery fails. A substitute starts from the independently updated control client's checkpoint and advances through verified history. Expedited governance authorizes recovery. The test checks that disputed consensus roots remain absent and that the fresh response window blocks early packet use. After that window it receives two more packets and restarts the host to check persisted state. Successful acknowledgements and the voucher balance establish delivery rather than just transaction inclusion.

The recorded lifecycle passes under the captured capacity limits. Its challenge is 127,909 bytes and uses 27,376,131 gas. Authorized recovery reaches checkpoint `1032`. A fresh response window blocks packet use until its deadline. The old checkpoint's proof still fails afterward. Packets then deliver a total of 300 voucher units and retain successful acknowledgements across a host restart.

The larger cases fail under those limits. A 3,815,978-byte challenge passes transaction admission but execution runs out of gas with a 75 million gas allowance. The client remains unfrozen. A 5,241,616-byte challenge is rejected by the block-size precheck. Their proposals are also rejected for insufficient gas. This is not a reproduced example of an admitted proposal whose challenge cannot execute. It establishes that these supported evidence cases do not work under the captured public capacity settings. Both pairs commit under the larger local profile. The near-limit proposal uses 242,851,313 gas and its challenge uses 214,433,028 gas. These results leave the production capacity gate open. No relayer or verifier limits were increased by this test.

Storage version `2` has a separate bounded execution replay. Its [recorded results](evidence/bounded-results.json) use the same pinned native `InjectiveApp` and captured gas parameters. A separate socket ABCI process executes the actual application with persistent stores and a controlled clock. The source CLI does not support standalone ABCI. This replay therefore does not measure public CometBFT inclusion or elapsed detection time. It uses seven days of source trust for the deliberately sparse synthetic Cardano history.

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
