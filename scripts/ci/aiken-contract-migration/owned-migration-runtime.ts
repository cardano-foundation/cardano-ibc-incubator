/** Bind disposable evidence/funding providers to the selected Docker project. */
import providers from "./owned-runtime-providers.cjs";

export const ownedRuntimeProviders = providers.ownedRuntimeProviders;

export async function validateOwnedRuntime(
  runtime: string,
  counterparty = false,
): Promise<string> {
  return ownedRuntimeProviders(runtime, counterparty).genesisSha256;
}
