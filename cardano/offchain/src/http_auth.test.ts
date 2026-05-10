import { assertEquals } from "@std/assert";

import {
  resolveManagedKupmiosHeaders,
  resolveManagedOgmiosUrl,
} from "./http_auth.ts";

Deno.test("resolveManagedOgmiosUrl uses Demeter authenticated HTTP host", () => {
  const resolved = resolveManagedOgmiosUrl(
    "https://cardano-preprod-v6.ogmios-m1.dmtr.host",
    "ogmios123",
  );

  assertEquals(
    resolved,
    "https://ogmios123.cardano-preprod-v6.ogmios-m1.dmtr.host",
  );
});

Deno.test("resolveManagedKupmiosHeaders omits Ogmios header on authenticated Demeter host", () => {
  const headers = resolveManagedKupmiosHeaders(
    "https://cardano-preprod-v2.kupo-m1.dmtr.host",
    "https://ogmios123.cardano-preprod-v6.ogmios-m1.dmtr.host",
    "kupo123",
    "ogmios123",
  );

  assertEquals(headers, { kupoHeader: { "dmtr-api-key": "kupo123" } });
});
