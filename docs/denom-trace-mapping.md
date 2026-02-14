# Denom Trace Mapping

This document shows a concrete example for how denom traces are created, finalized, and used for reverse lookup.

## Concrete Example

- Canonical denom example: `transfer/channel-7/ada`
- Computed IBC denom hash: `ibc/295902A2AC8AF68262566DB16795B73ED2D2B31C5B05FFF6A3299008DCB42FB1`
- Voucher token-name hash example: `a161cbad47f75408e7e815be862b38abe795ed21523749cae06a37696e79b892`

```mermaid
flowchart TB
  A["Input denom:<br/>transfer/channel-7/ada"] --> B["Normalize denom"]
  B --> C["Compute ibc hash:<br/>295902A2...DCB42FB1"]
  C --> D["Persist denom_trace row:<br/>hash=295902A2...DCB42FB1<br/>path=transfer/channel-7<br/>base_denom=ada"]
  D --> E["Build voucher token name:<br/>a161cbad...6e79b892"]
  E --> J["Register pending update<br/>with denom trace hash"]
  J --> K["Submit signed tx"]
  K --> L{"Confirmed and HostState<br/>root verified?"}
  L -->|No| M["Fail and do not<br/>finalize trace"]
  L -->|Yes| N["Attach tx_hash to trace row"]
  N --> O["Later input:<br/>ibc/295902A2...DCB42FB1"]
  O --> P["Reverse lookup in<br/>denom_trace:<br/>path/base_denom -><br/>transfer/channel-7/ada"]
  P --> Q["Burn/query uses<br/>canonical denom"]
```

## Notes

- The `denom_trace` row is the canonical source for reversing `ibc/<hash>` into `path/base_denom`.
- Finalization should only happen after transaction confirmation and HostState root verification.
