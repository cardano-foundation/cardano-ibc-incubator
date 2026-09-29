import { createScalusEvaluator } from "@lucid-evolution/scalus-uplc";

export const CARDANO_PROTOCOL_MAJOR_VERSION = 10;

export class ScriptEvaluationFailure extends Error {
  override name = "ScriptEvaluationFailure";

  constructor(message: string, cause: unknown) {
    super(`failed script execution: ${message}`, { cause });
  }
}

export function isScriptEvaluationFailure(error: unknown): boolean {
  const visited = new Set<object>();
  const containsFailure = (value: unknown): boolean => {
    if (value instanceof ScriptEvaluationFailure) {
      return true;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) {
      return false;
    }
    visited.add(value);
    return Reflect.ownKeys(value).some((key) => {
      try {
        return containsFailure(Reflect.get(value, key));
      } catch {
        return false;
      }
    });
  };
  return containsFailure(error);
}

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
        if (
          message.includes("Error evaluated") ||
          message.includes("Builtin error:")
        ) {
          throw new ScriptEvaluationFailure(message, error);
        }
        throw error;
      }
    },
  };
}
