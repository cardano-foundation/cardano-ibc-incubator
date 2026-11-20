// Run with the offchain Deno config from an isolated output directory.
import { Data, getAddressDetails } from "@lucid-evolution/lucid";
import { readValidator } from "../../cardano/offchain/src/utils.ts";
import { createDeployment } from "../../cardano/offchain/src/deployment.ts";
import { createYanoContext } from "./yano-provider.ts";

const { base, provider, lucid, key, address } = await createYanoContext();
if (Deno.env.get("YANO_ACTION") === "integration") {
  const { testShutdown } = await import("./yano-shutdown.ts");
  await testShutdown(lucid, base, key);
  Deno.exit(0);
}
if (Deno.env.get("YANO_ACTION") === "smoke") {
  const started = performance.now();
  const manifest = JSON.parse(
    await Deno.readTextFile("deployments/bridge-manifest.json"),
  );
  const [script] = readValidator(
    "minting_mock_token.mint_mock_token.mint",
    lucid,
  );
  const unit = manifest.tokens.mock;
  const balance = async () =>
    (await provider.getUtxos(address)).reduce(
      (sum, u) => sum + (u.assets[unit] ?? 0n),
      0n,
    );
  const before = await balance();
  let builder = lucid.newTx().attach.MintingPolicy(script).mintAssets({
    [unit]: 1n,
  }, Data.void());
  if (Deno.env.get("YANO_TIMED_SMOKE") === "1") {
    builder = builder.validFrom(Date.now() - 1000).validTo(Date.now() + 60000);
  }
  const tx = await builder.complete({ localUPLCEval: false });
  const signed = await tx.sign.withWallet().complete();
  const hash = await signed.submit();
  const deadline = performance.now() + 30000;
  while (await balance() !== before + 1n) {
    if (performance.now() > deadline) {
      throw new Error("Post-restore script transaction not adopted");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.log(
    JSON.stringify({
      scriptMintAdopted: true,
      hash,
      seconds: (performance.now() - started) / 1000,
    }),
  );
  Deno.exit(0);
}
const start = performance.now();
const response = await fetch(`${base}/devnet/fund`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address, ada: 100000 }),
});
const funding = await response.json();
if (!response.ok) throw new Error(JSON.stringify(funding));
console.log("Funding", funding);
for (let attempt = 0; attempt < 100; attempt++) {
  if ((await provider.getUtxos(address)).length) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
const funded = performance.now();
try {
  const authority = getAddressDetails(address).paymentCredential!.hash;
  await createDeployment(
    lucid,
    "yano",
    ["gateway", "packets"].includes(Deno.env.get("YANO_SUITE") ?? "")
      ? {
        deploymentMode: "upgradeable",
        migration: {
          governance: {
            signers: [authority],
            quorum: 1n,
            delay_ms: 86_400_000n,
          },
          emergency: { signers: ["77".repeat(28)], quorum: 1n },
          bootstrapSigners: [authority],
        },
      }
      : { deploymentMode: "legacy" },
  );
  await Deno.writeTextFile(
    "timing.json",
    JSON.stringify(
      {
        fundingSeconds: (funded - start) / 1000,
        deploymentSeconds: (performance.now() - funded) / 1000,
        success: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await Deno.writeTextFile(
    "timing.json",
    JSON.stringify(
      {
        fundingSeconds: (funded - start) / 1000,
        deploymentSeconds: (performance.now() - funded) / 1000,
        success: false,
        error: String(error),
      },
      null,
      2,
    ),
  );
  throw error;
}
