# Cardano Bridge Upgrade Compatibility

This document defines the compatibility contract for Cardano bridge upgrades.

The upgrade model is:

- the initial bridge registry is the stable across all upgrades
- one voucher policy is active for new mints
- zero or more previous active voucher policies may be listed as legacy
- legacy voucher policies may burn or refund legacy vouchers, but may not mint
  new first-seen vouchers
- compatible upgrades may replace protocol internals, but must preserve the
  stable registry, voucher, trace, denom, and metadata interfaces below

Note that bridge registry awareness is what makes the bridge upgradeable since it allows versioned deployments which can inherit certain components and mechanics while alterting/upgrading others, and "deprecating" existing vouchers (turning active voucher to legacy voucher).

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

### Voucher Metadata

Voucher display metadata must remain backward compatible or be explicitly
versioned. Stable metadata semantics include:

- CIP-68 datum format
- `name`
- `ticker`
- `description`
- `fullDenom`
- `ibcDenomHash`
- `voucherPolicyId`
- `voucherTokenName`
- metadata verification rules
- 
**
Optional fields may be added only if old decoders and validators can ignore
them safely. 
**

Changing the required structure or meaning of core fields requires a new metadata format version in the compatibility profile.

## What May Change

Compatible upgrades may change/upgrade implementation details that are discovered through the registry or do not alter the stable interfaces above.

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

The reason this can work is that registry-aware voucher policies read the bridge registry and discover the current active deployment:

- current HostState policy
- current channel minting policy
- current active voucher policy

New protocol mechanics may change, but the stable registry, voucher, trace, denom, and metadata interfaces must remain compatible so old vouchers can still be burned, refunded, and resolved.

## Unsupported Upgrades

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
