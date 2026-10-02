/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import { checkShutdownDrain } from "./shutdown-drain.ts";
self.onmessage = async ({ data }: MessageEvent<{ amount: bigint }>) => {
  try {
    await checkShutdownDrain({
      mode: "voucher",
      amount: data.amount,
      graceDays: 1,
    });
    self.postMessage({});
  } catch (error) {
    self.postMessage({
      error: error instanceof Error
        ? error.stack ?? error.message
        : String(error),
    });
  }
};
