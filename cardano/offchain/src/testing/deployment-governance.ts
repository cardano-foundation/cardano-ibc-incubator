import { getAddressDetails, type LucidEvolution } from "@lucid-evolution/lucid";

/** Single-signer governance only for isolated test networks. */
export async function testDeploymentGovernance(lucid: LucidEvolution) {
  const signer =
    getAddressDetails(await lucid.wallet().address()).paymentCredential!.hash;
  return {
    governance: { signers: [signer], quorum: 1n, delay_ms: 86_400_000n },
    emergency: { signers: ["ee".repeat(28)], quorum: 1n },
    bootstrapSigners: [signer],
  };
}
