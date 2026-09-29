import { assert, assertEquals, assertThrows } from "@std/assert";
import fc from "fast-check";
import { AccountingOracle } from "./testing/migration-accounting.ts";

// This test explores ECONOMIC MODEL histories, not ledger or counterparty proof
// acceptance. Real migration transactions are independently tested by the
// populated operator test; real packet acceptance requires the two-chain run.
Deno.test("generated multi-route economic histories preserve old claims through repeated partial migrations", () => {
  const coverage = new Set<string>();
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 6 }),
      fc.array(
        fc.record({
          route: fc.nat(100),
          operation: fc.nat(5),
          amount: fc.integer({ min: 1, max: 200 }),
          choice: fc.nat(100),
        }),
        { minLength: 40, maxLength: 180 },
      ),
      (routes, operations) => {
        const models = Array.from(
          { length: routes },
          () => new AccountingOracle(),
        );
        let packet = 0;
        const original = new Map<
          string,
          { route: number; kind: string; amount: bigint }
        >();
        const settled = new Set<string>();
        const assertBacking = () => {
          // Reconstruct from an append-only economic event journal, not pending
          // fields/methods of the object under test or migration implementation.
          const balances = Array.from(
            { length: routes },
            () => ({
              nativeAvailable: 1_000_000n,
              nativeEscrow: 0n,
              remoteNativeVouchers: 0n,
              foreignBacking: 0n,
              cardanoForeignVouchers: 0n,
            }),
          );
          for (const event of journal) {
            const b = balances[event.route], a = event.amount;
            switch (event.kind) {
              case "deposit":
                b.nativeAvailable -= a;
                b.nativeEscrow += a;
                break;
              case "mint-foreign":
                b.foreignBacking += a;
                b.cardanoForeignVouchers += a;
                break;
              case "burn-foreign":
                b.cardanoForeignVouchers -= a;
                break;
              case "burn-remote":
                b.remoteNativeVouchers -= a;
                break;
              case "native-delivered":
                b.remoteNativeVouchers += a;
                break;
              case "native-refund":
              case "native-redeemed":
                b.nativeEscrow -= a;
                b.nativeAvailable += a;
                break;
              case "foreign-redeemed":
                b.foreignBacking -= a;
                break;
              case "foreign-remint":
                b.cardanoForeignVouchers += a;
                break;
              case "remote-remint":
                b.remoteNativeVouchers += a;
                break;
            }
          }
          for (let route = 0; route < routes; route++) {
            const outstanding = [...original.entries()].filter(([id, p]) =>
              p.route === route && !settled.has(id)
            );
            assertEquals(
              [...models[route].pending.keys()].sort(),
              outstanding.map(([id]) => id).sort(),
            );
            for (const [id, p] of outstanding) {
              assertEquals(models[route].pending.get(id), {
                kind: p.kind === "deposit"
                  ? "native-send"
                  : p.kind === "burn-foreign"
                  ? "foreign-return"
                  : "native-return",
                amount: p.amount,
              });
            }
          }
          for (let i = 0; i < routes; i++) {
            for (
              const key of Object.keys(
                balances[i],
              ) as (keyof typeof balances[number])[]
            ) {
              assertEquals(models[i][key], balances[i][key]);
            }
          }
        };
        const journal: { route: number; kind: string; amount: bigint }[] = [];
        const settle = (id: string, success: boolean) => {
          const p = original.get(id)!;
          models[p.route].settle(id, success);
          settled.add(id);
          const kind = p.kind === "deposit"
            ? (success ? "native-delivered" : "native-refund")
            : p.kind === "burn-foreign"
            ? (success ? "foreign-redeemed" : "foreign-remint")
            : (success ? "native-redeemed" : "remote-remint");
          journal.push({ ...p, kind });
          coverage.add(kind);
          assertThrows(
            () => models[p.route].settle(id, success),
            Error,
            "already settled",
          );
        };
        for (let generation = 1; generation <= 3; generation++) {
          for (const [index, op] of operations.entries()) {
            if (index % 3 !== generation - 1) continue;
            const route = op.route % routes,
              m = models[route],
              amount = BigInt(op.amount),
              id = `${route}/${packet++}`;
            let kind = "";
            if (op.operation === 0) {
              m.sendNative(id, amount);
              kind = "deposit";
            }
            if (op.operation === 1) {
              m.receiveForeign(id, amount);
              journal.push({ route, amount, kind: "mint-foreign" });
            }
            if (op.operation === 2 && m.cardanoForeignVouchers >= amount) {
              m.burnForeign(id, amount);
              kind = "burn-foreign";
            }
            if (op.operation === 3 && m.remoteNativeVouchers >= amount) {
              m.burnRemoteNative(id, amount);
              kind = "burn-remote";
            }
            if (kind) {
              original.set(id, { route, kind, amount });
              journal.push({ route, kind, amount });
              coverage.add(kind);
            }
            if (op.operation >= 4) {
              const pending = [...original.keys()].filter((key) =>
                !settled.has(key)
              );
              if (pending.length) {
                settle(
                  pending[op.choice % pending.length],
                  op.operation === 4,
                );
              }
            }
            assertBacking();
          }
          const old = [...original.keys()].filter((key) => !settled.has(key));
          const frozen = models.map((m) => m.economicSnapshot());
          const objects = Array.from(
            { length: routes + generation },
            (_, n) => `state-${n}`,
          );
          for (const m of models) m.begin(objects);
          for (const [index, object] of objects.entries()) {
            for (const m of models) {
              assertThrows(() => m.activate(), Error, "unfinished");
              assertThrows(() => m.receiveForeign("late", 1n), Error, "frozen");
              m.move(object);
            }
            assertEquals(models.map((m) => m.economicSnapshot()), frozen);
            if (index === 1) coverage.add("interrupted-partial-migration");
          }
          for (const m of models) m.activate();
          coverage.add(`generation-${generation + 1}`);
          // Old burns can remint after activation; mix receive/ack success with
          // timeout/error refunds, never silently discard outstanding packets.
          for (const [i, id] of old.entries()) settle(id, i % 2 === 0);
          assertBacking();
        }
      },
    ),
    { seed: 462, numRuns: 100 },
  );
  for (
    const label of [
      "deposit",
      "burn-foreign",
      "burn-remote",
      "foreign-remint",
      "native-refund",
      "native-redeemed",
      "interrupted-partial-migration",
      "generation-4",
    ]
  ) assert(coverage.has(label), `Missing semantic coverage ${label}`);
  console.log(
    `economic model seed=462 histories=100 covered=${
      [...coverage].sort().join(",")
    }`,
  );
});
