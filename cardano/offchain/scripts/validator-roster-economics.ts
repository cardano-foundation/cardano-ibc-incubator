/** All inputs are complete signed fees in lovelace. The workload and hurdle
 * come from the proposed experiment, not an inferred live-traffic profile. */
export function rosterEconomics(
  hitSaving: number,
  changedExtra: number,
  hitPercent = 60,
  monthlyUpdates = 6000,
) {
  for (const value of [hitSaving, changedExtra, hitPercent, monthlyUpdates]) {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Economics inputs must be integer lovelace or counts");
    }
  }
  if (hitPercent < 0 || hitPercent > 100 || monthlyUpdates < 0) {
    throw new Error("Invalid workload");
  }
  const numerator = BigInt(hitPercent) * BigInt(hitSaving) -
    BigInt(100 - hitPercent) * BigInt(changedExtra);
  return {
    hitSavingLovelace: hitSaving,
    extraChangedSetLovelace: changedExtra,
    hitPercent,
    monthlyUpdates,
    netSavingPerUpdateLovelace: Number(numerator) / 100,
    monthlySavingLovelace: Number(numerator * BigInt(monthlyUpdates)) / 100,
    hurdlePerUpdateLovelace: 284000,
    clearsFivePercentHurdle: numerator >= 28400000n,
    requiredHitPercent: hitSaving + changedExtra > 0
      ? 100 * (284000 + changedExtra) / (hitSaving + changedExtra)
      : null,
  };
}
