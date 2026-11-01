import {
  Constr,
  Data,
  type LucidEvolution,
  type Script,
  validatorToRewardAddress,
} from "@lucid-evolution/lucid";
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
  const updateCore = readValidator(
    "verify_cached_client.verify_cached_client.withdraw",
    lucid,
    [hostPolicy, recoveryHash],
    Data.Tuple([Data.Bytes(), Data.Bytes()]) as unknown as [string, string],
  );
  const generalUpdateCore = readValidator(
    "verify_general_cached_client.verify_general_cached_client.withdraw",
    lucid,
    [hostPolicy, recoveryHash],
    Data.Tuple([Data.Bytes(), Data.Bytes()]) as unknown as [string, string],
  );
  const update = readValidator(
    "update_cached_client.update_cached_client.withdraw",
    lucid,
    [updateCore[1], generalUpdateCore[1], recoveryHash],
    Data.Tuple([Data.Bytes(), Data.Bytes(), Data.Bytes()]) as unknown as [
      string,
      string,
      string,
    ],
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
  // These credentials are registered once per deployment and must all be
  // deregistered with recovery authorization before the HostState is removed.
  const withdrawal = (title: string, tuple: [Script, string, string]) => ({
    title,
    validator: tuple[0],
    scriptHash: tuple[1],
    address: validatorToRewardAddress(
      lucid.config().network ?? "Custom",
      tuple[0],
    ),
  });
  const withdrawalScripts = [
    withdrawal("update_cached_client.update_cached_client.withdraw", update),
    withdrawal(
      "verify_cached_client.verify_cached_client.withdraw",
      updateCore,
    ),
    withdrawal(
      "verify_general_cached_client.verify_general_cached_client.withdraw",
      generalUpdateCore,
    ),
    withdrawal("update_staged_client.update_staged_client.withdraw", [
      staged.updateClient.validator,
      staged.updateClient.scriptHash,
      staged.updateClient.address,
    ]),
  ];
  return {
    withdrawalScripts,
    staged,
    cacheSpend,
    cacheMint,
    update,
    updateCore,
    generalUpdateCore,
    clientSpend,
    clientMint,
  };
}
