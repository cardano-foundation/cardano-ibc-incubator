import { assertEquals, assertThrows } from "@std/assert";
import { Constr, Data, fromText } from "@lucid-evolution/lucid";
import {
  type ClientRegistration,
  clientRegistryData,
} from "./client-registry.ts";

const first: ClientRegistration = {
  clientType: "07-tendermint",
  implementation: "tendermint",
  mintPolicy: "11".repeat(28),
  spendValidator: "22".repeat(28),
  proofPolicy: "33".repeat(28),
};
const second: ClientRegistration = {
  ...first,
  clientType: "07-tendermint-v2",
  mintPolicy: "44".repeat(28),
  spendValidator: "55".repeat(28),
};

Deno.test("client registrations preserve authority and implementation in Plutus parameters", () => {
  const encoded = Data.to(clientRegistryData([first, second]));
  assertEquals(
    Data.from(encoded),
    [first, second].map((registration) =>
      new Constr(0, [
        fromText(registration.clientType),
        new Constr(0, []),
        registration.mintPolicy,
        registration.spendValidator,
        registration.proofPolicy,
      ])
    ),
  );
});

Deno.test("client registrations reject ambiguous identities and scripts", () => {
  for (const field of ["clientType", "mintPolicy", "spendValidator"] as const) {
    assertThrows(
      () => clientRegistryData([first, { ...second, [field]: first[field] }]),
      Error,
      "Duplicate",
    );
  }
});

Deno.test("client registrations reject malformed or unsupported entries", () => {
  assertThrows(() => clientRegistryData([]), Error, "At least one");
  assertThrows(
    () => clientRegistryData([{ ...first, clientType: "../client" }]),
    Error,
    "Invalid",
  );
  assertThrows(
    () => clientRegistryData([{ ...first, proofPolicy: "" }]),
    Error,
    "Invalid",
  );
  assertThrows(
    () =>
      clientRegistryData([{
        ...first,
        implementation: "unknown" as "tendermint",
      }]),
    Error,
    "Unsupported",
  );
});
