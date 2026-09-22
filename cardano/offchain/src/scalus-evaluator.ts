import { createScalusEvaluator } from "@lucid-evolution/scalus-uplc";

export const CARDANO_PROTOCOL_MAJOR_VERSION = 10;
export function customEmulatorSlotConfig(emulator: { now(): number }) {
  return { zeroTime: emulator.now(), zeroSlot: 0, slotLength: 1000 };
}
export function createCardanoScalusEvaluator(
  protocolMajorVersion = CARDANO_PROTOCOL_MAJOR_VERSION,
): ReturnType<typeof createScalusEvaluator> {
  const evaluator = createScalusEvaluator({ protocolMajorVersion });
  return {
    ...evaluator,
    evaluate: async (input) => {
      try {
        return await evaluator.evaluate(input);
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : typeof error === "string"
          ? error
          : JSON.stringify(error);
        if (message.includes("Error evaluated")) {
          throw new Error(`failed script execution: ${message}`, {
            cause: error,
          });
        }
        throw error;
      }
    },
  };
}
