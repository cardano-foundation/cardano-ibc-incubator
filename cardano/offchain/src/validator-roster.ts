import {
  Constr,
  Data,
  type LucidEvolution,
  validatorToRewardAddress,
} from "@lucid-evolution/lucid";
import { loadCachedTendermintValidators } from "./tendermint-cache-validators.ts";
import {
  type CacheLeaf,
  cacheRecord,
  DirectUpdateUnsupported,
  prepareCachedHeader,
} from "./tendermint-cache.ts";
import { readValidator } from "./utils.ts";

/** Experimental fresh-deployment scripts. The production loader is unchanged. */
export function loadRosterPrototypeValidators(
  lucid: LucidEvolution,
  hostPolicy: string,
  recoveryHash: string,
) {
  const base = loadCachedTendermintValidators(lucid, hostPolicy, recoveryHash);
  const spend = readValidator(
    "experimental/validator_roster.validator_roster.spend",
    lucid,
    [base.cacheMint[1]],
  );
  const mint = readValidator(
    "experimental/mint_validator_roster.mint_validator_roster.mint",
    lucid,
    [hostPolicy, spend[1], base.cacheMint[1]],
  );
  const hit = readValidator(
    "experimental/verify_roster_client.verify_roster_client.withdraw",
    lucid,
    [hostPolicy, recoveryHash],
  );
  const clientSpend = readValidator(
    "experimental/roster_client.roster_client.spend",
    lucid,
    [
      hostPolicy,
      base.staged.updateClient.scriptHash,
      base.update[1],
      base.cacheMint[1],
      new Constr(1, [recoveryHash]),
      mint[1],
      hit[1],
    ],
  );
  const clientMint = readValidator(
    "minting_cached_client.mint_cached_client.mint",
    lucid,
    [clientSpend[1], hostPolicy, base.cacheMint[1]],
  );
  return {
    ...base,
    withdrawalScripts: [...base.withdrawalScripts, {
      title: "experimental/verify_roster_client.verify_roster_client.withdraw",
      validator: hit[0],
      scriptHash: hit[1],
      address: validatorToRewardAddress(
        lucid.config().network ?? "Custom",
        hit[0],
      ),
    }],
    clientSpend,
    clientMint,
    roster: {
      spend,
      mint,
      hit,
      rewardAddress: validatorToRewardAddress(
        lucid.config().network ?? "Custom",
        hit[0],
      ),
    },
  };
}

export function rosterRecordData(leaves: CacheLeaf[]): Constr<Data> {
  const record = cacheRecord(leaves);
  if (record.count > 128) {
    throw new Error("Roster prototype supports at most 128 validators per set");
  }
  return new Constr(0, [
    record.root,
    BigInt(record.count),
    record.totalPower,
    leaves.map((leaf) =>
      leaf.pubkey + leaf.power.toString(16).padStart(16, "0")
    ).join(""),
  ]);
}

export function rosterOrder(leaves: CacheLeaf[]): bigint[] {
  return [...leaves].sort((a, b) => a.pubkey.localeCompare(b.pubkey))
    .map((leaf) => BigInt(leaf.index));
}

/** Reuse the current bounded signer search and quorum arithmetic. The roster's
 * authenticated records must be supplied as cache.records by the caller. */
export function prepareRosterHeader(
  args: Parameters<typeof prepareCachedHeader>[0],
  token: { policyId: string; name: string },
) {
  const prepared = prepareCachedHeader(args);
  const update = (Data.from(prepared.redeemer) as Constr<Data>)
    .fields[0] as Constr<Data>;
  if ((update.fields[7] as Data[]).length) {
    throw new DirectUpdateUnsupported(
      "Required validator root is absent from the roster",
    );
  }
  const positions = (field: number) =>
    (update.fields[field] as Constr<Data>[]).map((leaf) => leaf.fields[0]);
  return {
    ...prepared,
    redeemer: Data.to<Data>(
      new Constr(7, [
        new Constr(0, [
          new Constr(0, [token.policyId, token.name]),
          update.fields[1],
          update.fields[2],
          positions(3),
          positions(5),
          update.fields[8],
        ]),
      ]),
      undefined,
      { canonical: true },
    ),
  };
}
