/// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />
import { checkShutdownDrain, type DrainCase } from "./shutdown-drain.ts";

function describe(error: unknown): string {
  return error instanceof Error
    ? (error.stack ?? error.message) +
      (error.cause ? "\n" + describe(error.cause) : "")
    : String(error);
}
self.onmessage = async ({ data }: MessageEvent<DrainCase>) => {
  console.log = () => {};
  try {
    await checkShutdownDrain(data);
    self.postMessage({});
  } catch (error) {
    self.postMessage({ error: describe(error) });
  }
};
