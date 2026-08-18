# VesselOracle Preservation

VesselOracle is preserved as dormant integration code after removal of the
unused intermediary application. It is not deployed, exposed through the
Gateway API, or registered on an async-ICQ host by the current repository.

The preserved pieces are:

- The canonical protobuf contract under
  `cosmos/vesseloracle-v10/proto/vesseloracle/vesseloracle`, together with its
  generated TypeScript bindings in `proto-types`.
- The Gateway packet and acknowledgement adapter under
  `cardano/gateway/src/shared/types/apps/async-icq/vesseloracle-icq.ts`.
- The Gateway transaction orchestration service and DTOs under
  `cardano/gateway/src/api`. These compile and remain covered by focused tests,
  along with a preserved `VesseloracleIcqController`; both the service and
  controller are intentionally absent from `ApiModule`.
- The complete dormant Cosmos SDK module under `cosmos/vesseloracle-v10`,
  including keeper state, transactions, queries, genesis handling, CLI and
  simulation support, and its original behavioral tests.

Reactivation requires a target Cosmos application that implements the
VesselOracle query contract. That application must register the standalone
`cosmos/async-icq-v10` host on `icqhost` and allow these query paths:

```text
/vesseloracle.vesseloracle.Query/ConsolidatedDataReport
/vesseloracle.vesseloracle.Query/LatestConsolidatedDataReport
```

Only after such a target exists should `VesseloracleIcqService` and
`VesseloracleIcqController` be registered in `ApiModule`. The deleted
intermediary binary, chain configuration, and local demo are not prerequisites;
a future target chain can integrate the preserved standalone module or
implement the same protobuf service independently.
