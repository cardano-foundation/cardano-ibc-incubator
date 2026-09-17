import { type LucidEvolution, slotToUnixTime } from "@lucid-evolution/lucid";
import { queryOgmiosJsonRpc } from "./external_cardano.ts";

/** Use the selected chain's time, including an isolated devnet's clock. Ledger
 * inclusion still enforces these bounds; neither an index nor a local wall clock
 * can shorten the on-chain governance delay.
 */
export async function migrationTiming(
  lucid: LucidEvolution,
  ogmiosUrl: string,
) {
  const { result } = await queryOgmiosJsonRpc(
    ogmiosUrl,
    "queryNetwork/tip",
    {},
  );
  if (
    !result || !Number.isSafeInteger(result.slot) || result.slot < 0 ||
    !/^[0-9a-f]{64}$/.test(result.id)
  ) {
    throw new Error(
      "Ogmios has no valid canonical chain tip for migration timing",
    );
  }
  const network = lucid.config().network;
  if (!network) {
    throw new Error("Migration requires the configured Cardano network");
  }
  const validFrom = slotToUnixTime(network, result.slot);
  if (!Number.isSafeInteger(validFrom)) {
    throw new Error("Unsupported slot/time conversion");
  }
  return {
    validFrom,
    validTo: validFrom + 300_000,
    slot: result.slot as number,
  };
}
