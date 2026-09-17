/** Bind disposable evidence/funding providers to the selected Docker project. */
import { join, resolve } from "@std/path";
import { createHash } from "node:crypto";

export async function validateOwnedRuntime(
  runtime: string,
  counterparty = false,
): Promise<string> {
  const root = resolve(import.meta.dirname!, "../..");
  const canonical = await Deno.realPath(runtime);
  if (!canonical.startsWith(join(root, ".deployment-smoke") + "/")) {
    throw new Error("Explicit owned disposable runtime required");
  }
  const result = JSON.parse(
    await Deno.readTextFile(join(canonical, "result.json")),
  );
  if (
    !/^cardano-deployment-test-[a-z0-9]+$/.test(result.project) ||
    result.networkRuntime !== canonical
  ) {
    throw new Error(
      "Runtime/project provenance differs from deployment result",
    );
  }
  const compose = [
    "compose",
    "-p",
    result.project,
    "-f",
    join(canonical, "compose.json"),
  ];
  async function docker(args: string[]) {
    const command = await new Deno.Command("docker", {
      args: [...compose, ...args],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!command.success) throw new Error("Owned runtime inspection failed");
    return new TextDecoder().decode(command.stdout);
  }
  const endpoints = [["ogmios", "1337", "2637"], ["kupo", "1442", "2742"]];
  if (counterparty) {
    endpoints.push(["cosmos", "26657", "28757"], ["cosmos", "1317", "1527"]);
  }
  for (const [service, port, published] of endpoints) {
    if (
      (await docker(["port", service, port])).trim() !==
        `127.0.0.1:${published}`
    ) {
      throw new Error(
        `Provider ${service} is not owned by the selected runtime`,
      );
    }
  }
  const local = await Deno.readTextFile(
    join(canonical, "runtime/genesis-shelley.json"),
  );
  const actual = await docker([
    "exec",
    "-T",
    "node",
    "cat",
    "/runtime/genesis-shelley.json",
  ]);
  if (actual !== local || JSON.parse(actual).networkMagic !== 42) {
    throw new Error("Provider genesis does not match the selected fixture");
  }
  return createHash("sha256").update(local).digest("hex");
}
