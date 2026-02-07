## Challenges in HostState UTxO Sharding Mechanics

Author: Julius Tranquilli,https://github.com/floor-licker

Date: February 5, 2026 

**TO-DO: We should stay up to date with the hydra heads/tails implementations to see if they may help us with any scaling issues**

The intention of this document is to describe the current state of the Cardano on-chain host state which is able to satisfy IBC trustlessness and and Tendermint monotonicity invariants, but which also serializes IBC operations on Cardano. 

A core question to keep in mind before we dig into the challenge of sharding (or batching) is: 

**Can we avoid a Cardano transaction being the minimal unit of IBC state change for Cardano IBC host state**. 

The core reason that this is a substantial engineering problem on a UTxO ledger like Cardano is that the UTxO model is literally that "chain state = set of unspent outputs" and "transactions are the only state transition unit". As a direct consequence of that, Cardano validators are not going to have the ability to reason about some sort of "intermediate" step which might be able to exist in smart contract storage in an account-based VM, so validation and authentication can strictly rely on inputs and outputs of a given transaction.

An easier-sounding solution to sharding might be batching operations, but I consider this to be an easier-to-break and harder-to-test solution than sharding, especially with lots of branching and proprietary logic about which types of operations can be batched together and when. You would also have entire batches of operations which need to calculate root changes and apply them **correctly and deterministically and in the same order**. If any one of them does **anything** incorrectly (one flaky proof, one stale UTxO, one wrong witness list, one race on an input like a referenced connection/channel moved), whether its an accident, or griefing, or malicious, the entire batch of operations would be invalidated and would not go through, i.e, a block with 0 IBC operations. Each transaction is basically an all-eggs-in-one-basket attempt. We would also need a logic where we define a deterministic ordering of updates inside the batch, detect/forbid conflicting writes between sub-ops, allocate sequences/IDs correctly to enumerate channels on the fly in a monotonic order with no intermediate step (i.e, channel IDs `N`...`N+k`, **while** being aware of predecessing channel creations/deletions batched in the same block), and carry witnesses per update, which is a huge surface area for subtle bugs, and I would argue an unreasonably brittle and error-prone system for a production bridge. This would also make the bridge **very** easy to grief, so guarding against that would need to be an entirely separate initiative even if we were able to build a mechanism that works.

In general sharding is a complex problem, but even more so in our case because of the logic of the mechanism we are attempting to shard. The HostState UTxO does not have a singular function, like computation, which could be easily partitioned, like through nodes of a blockchain.

The HostState UTxO is doing two jobs at once:

**#1. Serving as a global mutex + total order for IBC writes**

**#2. The authenticated commitment root (`ibc_state_root`) that the counterparty verifies proof against**

And it's not arbitrary or a mistake that those concepts are tightly coupled. In a UTxO ledger, root correctness means that the validator must be able to prove that the *new* root is the unique successor of a *specific* old root given the writes performed in this transaction. The only way to bind the transition to a specific old root is to require the transaction to **spend** the UTxO that carries it (not merely reference it), because spending a UTxO is what makes it impossible for two competing transactions to both start from the same predecessor root. That same requirement automatically gives you ordering: if there's exactly one spendable HostState thread, then there can only be one canonical next root, because there can only be one valid consumer of that input. Apart from the serialization it's an actually an extremely nice design pattern.

The STT design is our Cardano-native implementation of the Cosmos property that "there is exactly one canonical post-state per height, and the state root is consensus-relevant".

So concretely, the HostState STT validator is enforcing the following three invariants; firstly, that exactly one HostState NFT UTxO exists, and updates must consume + recreate it, which gives you the "there is only one next root" property. Secondly, the root correctness property; you don't just store a root, you make it meaningful by requiring that every accepted transition proves the root update matches the actual writes in that transaction (siblings/witnesses, recomputation), so the operator can't arbitrarily pick a new root. Finally externally usable anchoring: once a counterparty can authenticate which transaction/output datum is canonical at some checkpoint, it can treat the extracted `ibc_state_root` like an `app_hash` surrogate for Cardano IBC host state.

The core thing to understand (more obvious for Cardano-natives) here is that validators cannot observe or persist intermediate states: they only validate a transaction as a mapping from a fixed set of inputs to a fixed set of outputs. The ledger doesn't have an "execute a list of messages, update state after each message" model where a later step can consume an earlier step's committed state within the same transaction. The only observable state transition unit is a transaction: a tx consumes a set of input UTxOs and produces a set of output UTxOs, and validators can only validate properties about that input-to-output mapping, which implies a hard constraint for IBC. **IBC operations must be expressed at transaction granularity because that's the only granularity at which IBC state changes are real and checkable on-chain**.

## Example
Imagine you want two IBC operations inside the same transaction, and you'd like them to behave as if there were an intermediate HostState, so in your ideal world things would look like:

1. start at HostState with `R_0`

2. apply op A -> get intermediate root `R_1`

3. apply op B -> get final root `R_2`

And yes, **in an account-based VM you can literally do that:** the program executes op A, the VM has an intermediate state, then op B sees the same result. 

In UTxO validation, there is no place where `R_1` can exist as an intermediate *on-chain* state within the same transaction. The HostState validator sees one HostState input UTxO and one HostState output UTxO. It can check that the output root is consistent with the input root plus the claimed writes, but it cannot rely on `R_1` being committed anywhere that another step can consume, because there is no intermediate output UTxO/datum that exists "between" those operations.

Importantly, this does not mean you could never do more than one IBC update per transaction. You *could* batch multiple IBC operations into a single transaction, and the on-chain validation can compute intermediate roots internally as local variables (for example compute `R_1` then `R_2`) and finally require that the output HostState datum contains `R_2`. 
**The key point is that `R_1` would not be a ledger state: it would not exist as an output UTxO/datum that any other validator can reference or enforce, it would only be an internal step in the proof that the single transition from `R_0` to `R_2` is correct. On-chain, the only commitment that exists is whatever is in the final output datum.**

So because validators can only reason about inputs/outputs, the design forces one atomic transaction-scoped proof obligation, which is: given the exact reads/writes in this tx (and some deterministic ordering for those writes), the new root must equal the old root with exactly those key updates applied.


## Multi-lane Mutex Sharding (TO-DO) (WIP) (Contributions Welcomed)

This is my initial design for UTxO sharding. There are to be fleshed out which are explained clearly but I believe this style of design is the right track for something which multiplies throughput while avoiding a very complex and difficult-to-test on-chain system.

We can imagine how instead of one spendable HostState thread, you'd have a small **fixed** set of spendable "lane" UTxOs, a parition. So suppose there are three such UTxOs, `X_1, ..., X_3`. So imagine whenever an IBC operation is reaching for that HostState UTxO, its instead reaching into a bag (think of a `sync_pool`-like data structure like we have in go's standard lib), and that structure is just returning the lowest available `X_i` up to `i=3`. You could even let `i` get nearly arbitrarily large and just have a garbage-collection style system every few blocks to avoid UTxO bloat. 

So in a block, up to 3 IBC transactions could each consume one lane, and the resulting state evolution would be comlpetely deterministic and monotonic because each incoming transaction would consume the lowest available `i` for `X_i`, and so that gives us a deterministic ordering and host state mutation per transaction. The immediate thing to notice with that idea is that deterministic *selection* of lanes is not the same thing as deterministic *composition* of state roots. 

If `X_1`, `X_2`, and `X_3` can all be spent in the same block by different transactions, then each transaction is necessarily starting from the same predecessor root (whatever the current canonical HostState root is) and producing a different successor root. That means the system has multiple competing "next roots" in the same block, and there is no longer a single canonical `ibc_state_root` unless we add an explicit merge rule. But if you add a merge rule, you necessarily re-introduce a contended serialization point (some mechanism must merge the lane results into one canonical next root), which is essentially a rollup/batching step by another name and introduces all the same complexities we discussed earlier.

Validators also can't actually enforce "this transaction must be considered after that other transaction in the same block" unless the dependency is expressed by consuming a specific output. Block order is not an input to script validation. So even if off-chain code assigns "lowest `i` wins", on-chain there is no way to force `X_1`'s update to be applied before `X_2`'s update in a way that yields one canonical root without one of:

1. A merge step: some follow-up transaction consumes the lane results and produces a single new HostState root (which re-introduces a contention bottleneck, and is essentially a kind of rollup/batching step), **or**

2. True sequential chaining: `X_i` has to consume an output created by the `X_{i-1}` transaction (like `X_3` must consume an output created by `X_2`), which restores the unique-predecessor property but also means the transactions are not independently constructible (i.e the relayer + gateway has to be able to build, sign, and submit its IBC transaction without needing any yet-to-be-created UTxO produced by another transaction in the same block, so this doesn't make sense because you can't fully form `X_i` ahead of time, also you lose parallel submission by independent actors because multiple relayers can't all submit their own lane transactions concurrently and expect the chain to order them into the correct monotonically ascending series of shards), **or**

3. Actual sharding of the commitment: each lane commits to a disjoint slice of IBC state (its own shard root), and the "global root" becomes a function of all shard roots (for example a root-of-roots), so lanes do not need to be merged into a single successor root for every operation.

So in my view, the core take away here is that this sharding mechanism is likely viable, but only really becomes coherent if we frame this as lanes not just bieng "extra mutexes" but actually seaprate commitment threads (like each lane owns a shard root over a disjoint keyspace) and then you define a verifiable global commitment (root of all roots). (TO-DO)
