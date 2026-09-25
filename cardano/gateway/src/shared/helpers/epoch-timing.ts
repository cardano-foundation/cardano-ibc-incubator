export type EpochTiming = {
  firstEpochSlot: bigint;
  epochLengthSlots: bigint;
  slotLengthMs: number;
};

type EraSummary = {
  start: { slot: number; epoch: number };
  end?: { slot: number };
  parameters: { epochLength: number; slotLength: { milliseconds: number } };
};

/** Derive the exact current epoch boundary from Ogmios era summaries. */
export function epochTimingAtSlot(summaries: EraSummary[], slot: bigint, expectedEpoch: number): EpochTiming {
  const era = summaries.find((summary) =>
    slot >= BigInt(summary.start.slot) &&
    (summary.end === undefined || slot < BigInt(summary.end.slot))
  );
  if (!era || !Number.isSafeInteger(era.start.slot) || !Number.isSafeInteger(era.start.epoch) ||
    !Number.isSafeInteger(era.parameters.epochLength) || era.parameters.epochLength <= 0 ||
    !Number.isSafeInteger(era.parameters.slotLength.milliseconds) ||
    era.parameters.slotLength.milliseconds <= 0) {
    throw new Error('Cardano era timing is unavailable');
  }

  const eraStartSlot = BigInt(era.start.slot);
  const epochLengthSlots = BigInt(era.parameters.epochLength);
  const completedEpochs = (slot - eraStartSlot) / epochLengthSlots;
  if (era.start.epoch + Number(completedEpochs) !== expectedEpoch) {
    throw new Error(`Cardano history epoch ${expectedEpoch} does not match Ogmios era timing`);
  }

  return {
    firstEpochSlot: eraStartSlot + completedEpochs * epochLengthSlots,
    epochLengthSlots,
    slotLengthMs: era.parameters.slotLength.milliseconds,
  };
}
