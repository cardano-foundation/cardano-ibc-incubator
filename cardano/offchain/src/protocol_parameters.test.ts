import { assertEquals, assertThrows } from "@std/assert";
import {
  SLOT_CONFIG_NETWORK,
  slotToUnixTime,
  unixTimeToSlot,
} from "@lucid-evolution/lucid";
import { customOperationalSlotConfig } from "./protocol_parameters.ts";

Deno.test("Custom operational clock uses actual nonzero slot length and leaves public networks unchanged", () => {
  const start = Date.parse("2025-12-30T02:00:00Z");
  const zeroEra = {
    start: { slot: 0, time: { seconds: 0 } },
    end: { slot: 0 },
    parameters: { slotLength: { milliseconds: 250 } },
  };
  const liveEra = {
    ...zeroEra,
    end: { slot: 5000 },
    parameters: { slotLength: { milliseconds: 1000 } },
  };
  const original = { ...SLOT_CONFIG_NETWORK.Custom };
  const preview = { ...SLOT_CONFIG_NETWORK.Preview };
  try {
    SLOT_CONFIG_NETWORK.Custom = customOperationalSlotConfig(start, [
      zeroEra,
      liveEra,
    ]);
    assertEquals(slotToUnixTime("Custom", 3200), start + 3_200_000);
    assertEquals(unixTimeToSlot("Custom", start + 3_500_000), 3500);
    assertEquals(SLOT_CONFIG_NETWORK.Preview, preview);
  } finally {
    SLOT_CONFIG_NETWORK.Custom = original;
  }
});

Deno.test("Custom operational clock rejects zero lengths and unsupported historical era models", () => {
  const era = {
    start: { slot: 0, time: { seconds: 0 } },
    end: { slot: 5000 },
    parameters: { slotLength: { milliseconds: 1000 } },
  };
  for (
    const invalid of [[], [{}], [{
      ...era,
      parameters: { slotLength: { milliseconds: 0 } },
    }], [era, {
      ...era,
      start: { slot: 5000, time: { seconds: 5000 } },
      end: { slot: 10000 },
      parameters: { slotLength: { milliseconds: 2000 } },
    }], [{ ...era, start: { slot: 1, time: { seconds: 1 } } }]]
  ) {
    assertThrows(() => customOperationalSlotConfig(1_700_000_000_000, invalid));
  }
});
