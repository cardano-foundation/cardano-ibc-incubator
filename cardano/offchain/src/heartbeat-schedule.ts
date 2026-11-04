import {
  Constr,
  type LucidEvolution,
  SLOT_CONFIG_NETWORK,
} from "@lucid-evolution/lucid";
import {
  checkedHeartbeatSchedule,
  type HeartbeatSchedule,
} from "../../../packages/cardano-ibc-tx-builder-runtime/src/heartbeatSchedule.ts";

export function deploymentHeartbeatSchedule(
  lucid: LucidEvolution,
  explicit?: HeartbeatSchedule,
): HeartbeatSchedule {
  if (explicit) return checkedHeartbeatSchedule(explicit);
  const network = lucid.config().network ?? "Custom";
  const slot = lucid.config().slotConfig ?? SLOT_CONFIG_NETWORK[network];
  // Custom deployments pass node-derived timing in index.ts. The default is
  // also useful for deterministic Emulator plans with five-day epochs.
  return checkedHeartbeatSchedule({
    epochOriginMs: slot.zeroTime,
    epochLengthMs: (network === "Preview" ? 86_400 : 432_000) * slot.slotLength,
  });
}

export function heartbeatScheduleData(
  schedule: HeartbeatSchedule,
): Constr<bigint> {
  const checked = checkedHeartbeatSchedule(schedule);
  return new Constr(0, [
    BigInt(checked.epochOriginMs),
    BigInt(checked.epochLengthMs),
  ]);
}
