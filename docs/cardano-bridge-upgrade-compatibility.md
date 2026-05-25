# Cardano Bridge Upgrade Compatibility

This document defines the compatibility contract for Cardano bridge upgrades.
It is normative for registry-aware bridge deployments that want legacy vouchers
from an earlier deployment to remain redeemable under a newer deployment.

The upgrade model is:

- the bridge registry is the stable upgrade anchor
- one voucher policy is active for new mints
- zero or more previous active voucher policies may be listed as legacy
- legacy voucher policies may burn or refund existing vouchers, but may not mint
  new first-seen vouchers
- compatible upgrades may replace protocol internals, but must preserve the
  stable registry, voucher, trace, denom, and metadata interfaces below

## Compatibility Claim

Only registry-aware bridge versions are upgradeable through this mechanism.

A voucher policy is registry-aware when it is parameterized with the bridge
registry auth token and reads the registry datum to discover the current active
deployment. A historical voucher policy that hardcodes the old HostState policy,
old channel policy, or old deployment context is not made upgradeable merely by
adding its policy id to `legacy_voucher_policy_ids`.

The supported claim is:

> Registry-aware voucher policies remain compatible while the bridge registry,
> voucher identity, trace registry, denom semantics, and metadata formats remain
> backward compatible.

The unsupported claim is:

> Any historical Cardano IBC voucher policy can be upgraded forever.

## Stable Interfaces

The following interfaces must remain stable across compatible upgrades.

### Bridge Registry

The bridge registry is the anchor that lets old voucher policies discover the
current active deployment. These fields and semantics must remain backward
compatible:

- bridge registry auth token
- bridge registry datum schema
- meaning of `active_deployment`
- meaning of `active_voucher_policy_id`
- meaning of `legacy_voucher_policy_ids`
- governance key semantics

If an old voucher policy was parameterized with a `bridge_registry_token`, it
can follow upgrades only while the same registry token continues to exist and
the datum remains decodable by that old policy.

Rule:

> Registry-aware voucher policies remain upgradeable only while the bridge
> registry token and datum schema remain backward compatible.

### Voucher Asset Identity

Voucher asset identity must not change across compatible versions.

The stable identity rules are:

- CIP-67 user token label is `333`
- CIP-67 reference NFT label is `100`
- denom hash length is 28 bytes
- denom hash algorithm is stable
- full denom canonical byte encoding is stable
- user token asset name is `333 || hash(full_denom)`
- reference NFT asset name is `100 || hash(full_denom)`
- the reference NFT and user token for a denom use the same denom hash suffix

The voucher identity is:

```text
voucher_policy_id + labeled_asset_name
```

If any of these rules change, old vouchers may still exist on-chain, but the new
bridge, Gateway, relayer, wallet, or indexer may no longer understand what they
represent. That is not a compatible upgrade.

### ICS-20 Denom And Packet Semantics

Old and new bridge versions must agree on the semantics needed to redeem,
refund, and account for vouchers:

- full denom trace construction
- source/sink chain detection
- packet denom encoding
- packet amount encoding
- sender encoding
- receiver encoding
- acknowledgement encoding
- timeout and refund semantics

Burning a legacy voucher for denom `D` is only compatible if the new bridge
interprets `D` exactly as the old bridge did.

### Trace Registry

The current compatibility model uses a stable shared trace registry across
compatible upgrades.

These trace registry properties must remain stable:

- directory auth token
- bucket selection algorithm
- shard datum format
- directory datum format
- `voucher_hash -> full_denom` mapping semantics
- append rules
- rollover rules
- archived shard lookup semantics

The trace registry is necessary because a Cardano wallet holding a voucher sees
only:

```text
policy_id + (333 || voucher_hash)
```

It does not contain the full denom trace. If the new bridge cannot resolve the
old voucher hash to the old full denom, the voucher may be practically stranded
even if the policy id is listed as legacy.

Alternative designs are allowed only with an explicit migration plan:

- versioned trace registries listed in the bridge registry, with resolvers that
  query current and legacy registries
- complete migration of old trace entries into a new trace registry

Until such a design exists, compatible upgrades must keep the trace registry
stable.

### Voucher Metadata

Voucher display metadata must remain backward compatible or be explicitly
versioned.

Stable metadata semantics include:

- CIP-68 datum format
- `name`
- `ticker`
- `description`
- `fullDenom`
- `ibcDenomHash`
- `voucherPolicyId`
- `voucherTokenName`
- metadata verification rules

Optional fields may be added only if old decoders and validators can ignore
them safely. Changing the required structure or meaning of core fields requires
a new metadata format version in the compatibility profile.

## What May Change

Compatible upgrades may change implementation details that are discovered
through the registry or do not alter the stable interfaces above.

The following may change across compatible versions:

- HostState validator
- HostState NFT policy
- channel minting policy
- channel validators
- connection validators
- client validators
- transfer module implementation
- active voucher minting policy
- reference script locations
- Gateway implementation
- relayer implementation
- metadata builder internals, if the output format remains stable

The reason this can work is that registry-aware voucher policies read the bridge
registry and discover the current active deployment:

- current HostState policy
- current channel minting policy
- current active voucher policy

New protocol mechanics may change, but the stable registry, voucher, trace,
denom, and metadata interfaces must remain compatible so old vouchers can still
be burned, refunded, and resolved.

## What Requires Migration

The following changes are not compatible by default and require an explicit
migration mechanism:

- changing the bridge registry auth token
- changing the bridge registry datum in a way old policies cannot decode
- changing voucher asset-name derivation
- changing the denom hash algorithm or length
- changing full denom canonical encoding
- changing ICS-20 source/sink semantics
- changing packet data encoding in a way old vouchers cannot redeem
- replacing the trace registry without versioned lookup or entry migration
- changing the metadata datum format without a versioned compatibility profile
- supporting a non-registry-aware historical voucher policy

A migration may be implemented by a new registry version, versioned trace
registries, explicit trace-entry migration, or a purpose-built recovery path.
The migration must be specified before the upgrade is considered compatible.

## Unsupported Cases

The following are unsupported under this compatibility model:

- adding arbitrary unrelated voucher policies to `legacy_voucher_policy_ids`
- listing a policy as legacy when it cannot validate in the new transaction
  context
- assuming old trace entries are resolvable without a stable or versioned trace
  registry
- treating a non-registry-aware voucher policy as upgradeable
- changing voucher asset identity while claiming existing vouchers remain
  compatible

The bridge registry update rule should only rotate the previous active voucher
policy into legacy:

```text
new_legacy == old_legacy union { old_active }
```

It should not admit unrelated legacy policies as a normal upgrade path.

## Compatibility Profile

A legacy voucher entry should carry an explicit compatibility profile so Gateway
and transaction builders can refuse unsupported legacy burns at startup instead
of failing at submit time.

The profile should identify at least:

- voucher policy id
- voucher reference script UTxO
- voucher asset-name version
- mint voucher redeemer version
- packet data encoding version
- transfer denom logic version
- channel id derivation version
- HostState/channel semantics version
- bridge registry token
- trace registry id
- metadata format version
- compatible bridge version

Gateway startup must reject legacy voucher support when the profile is missing
or incompatible with the active bridge context.

