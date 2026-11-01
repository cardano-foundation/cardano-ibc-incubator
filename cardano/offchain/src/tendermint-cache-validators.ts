import { Constr, Data, type LucidEvolution } from "@lucid-evolution/lucid";
import { loadStagedTendermintValidators } from "./deployment-plan.ts";
import { readValidator } from "./utils.ts";

/** Opt-in prototype. Register clientSpend with the normal client registry. */
export function loadCachedTendermintValidators(
  lucid: LucidEvolution,
  hostPolicy: string,
  recoveryHash: string,
) {
  const staged = loadStagedTendermintValidators(
    lucid,
    hostPolicy,
    recoveryHash,
  );
  const update = readValidator(
    "update_cached_client.update_cached_client.withdraw",
    lucid,
    [hostPolicy, recoveryHash],
    Data.Tuple([Data.Bytes(), Data.Bytes()]) as unknown as [string, string],
  );
  const cacheSpend = readValidator(
    "spending_validator_cache.spend_validator_cache.spend",
    lucid,
    [staged.sessionMint.policyId, update[1], staged.updateClient.scriptHash],
    Data.Tuple([Data.Bytes(), Data.Bytes(), Data.Bytes()]) as unknown as [
      string,
      string,
      string,
    ],
  );
  const cacheMint = readValidator(
    "minting_validator_cache.mint_validator_cache.mint",
    lucid,
    [hostPolicy, cacheSpend[1]],
    Data.Tuple([Data.Bytes(), Data.Bytes()]) as unknown as [string, string],
  );
  const clientSpend = readValidator(
    "spending_cached_client.spend_cached_client.spend",
    lucid,
    [
      hostPolicy,
      staged.updateClient.scriptHash,
      update[1],
      cacheMint[1],
      new Constr(1, [recoveryHash]),
    ],
  );
  const clientMint = readValidator(
    "minting_cached_client.mint_cached_client.mint",
    lucid,
    [clientSpend[1], hostPolicy, cacheMint[1]],
    Data.Tuple([Data.Bytes(), Data.Bytes(), Data.Bytes()]) as unknown as [
      string,
      string,
      string,
    ],
  );
  return { staged, cacheSpend, cacheMint, update, clientSpend, clientMint };
}
