/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import type { SendParameters } from "./send-budget-fixture.ts";
import type { Settlement } from "./funds-lifecycle.ts";
import { checkPacketFundsCase } from "./packet-funds-history.ts";

export interface FundsCase {
  parameters: SendParameters;
  voucherBase?: string;
  destinations?: { hash: string; script: boolean }[];
  amounts: bigint[];
  commands: { send: boolean; index: number; settlement: Settlement }[];
}

self.onmessage = async ({ data }: MessageEvent<FundsCase>) => {
  try {
    await checkPacketFundsCase(data);
    self.postMessage({});
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.stack : String(error),
    });
  }
};
