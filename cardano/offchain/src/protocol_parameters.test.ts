import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  Lucid,
  SLOT_CONFIG_NETWORK,
  slotToUnixTime,
  unixTimeToSlot,
} from "@lucid-evolution/lucid";
import { Emulator } from "@lucid-evolution/provider";
import protocolProfile from "../../../chains/cardano/config/protocol-parameters.json" with {
  type: "json",
};
import {
  customOperationalSlotConfig,
  queryProtocolParametersCompat,
  sanitizeProtocolParameters,
} from "./protocol_parameters.ts";

Deno.test("Ogmios cost models remain arrays through real Lucid initialization", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          result: {
            version: { major: 11, minor: 0 },
            minFeeCoefficient: protocolProfile.txFeePerByte,
            minFeeConstant: {
              ada: { lovelace: protocolProfile.txFeeFixed },
            },
            maxTransactionSize: { bytes: protocolProfile.maxTxSize },
            maxValueSize: { bytes: protocolProfile.maxValueSize },
            stakeCredentialDeposit: {
              ada: { lovelace: protocolProfile.stakeAddressDeposit },
            },
            stakePoolDeposit: {
              ada: { lovelace: protocolProfile.stakePoolDeposit },
            },
            delegateRepresentativeDeposit: {
              ada: { lovelace: protocolProfile.dRepDeposit },
            },
            governanceActionDeposit: {
              ada: { lovelace: protocolProfile.govActionDeposit },
            },
            scriptExecutionPrices: {
              memory: "577/10000",
              cpu: "721/10000000",
            },
            maxExecutionUnitsPerTransaction: {
              memory: protocolProfile.maxTxExecutionUnits.memory,
              cpu: protocolProfile.maxTxExecutionUnits.steps,
            },
            utxoCostPerByte: protocolProfile.utxoCostPerByte,
            collateralPercentage: protocolProfile.collateralPercentage,
            maxCollateralInputs: protocolProfile.maxCollateralInputs,
            minFeeReferenceScripts: {
              base: protocolProfile.minFeeRefScriptCostPerByte,
            },
            plutusCostModels: {
              "plutus:v1": protocolProfile.costModels.PlutusV1,
              "plutus:v2": protocolProfile.costModels.PlutusV2,
              "plutus:v3": protocolProfile.costModels.PlutusV3,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

  try {
    const normalized = sanitizeProtocolParameters(
      await queryProtocolParametersCompat("http://ogmios.invalid"),
    );
    assert(Array.isArray(normalized.costModels.PlutusV1));
    assert(Array.isArray(normalized.costModels.PlutusV2));
    assert(Array.isArray(normalized.costModels.PlutusV3));
    assertEquals(
      normalized.costModels.PlutusV3,
      protocolProfile.costModels.PlutusV3,
    );

    const emulator = new Emulator([], normalized);
    const lucid = await Lucid(emulator, "Custom", {
      presetProtocolParameters: normalized,
      slotConfig: { zeroTime: 0, zeroSlot: 0, slotLength: 1000 },
    });
    assertEquals(
      lucid.config().protocolParameters?.costModels.PlutusV3,
      protocolProfile.costModels.PlutusV3,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

Deno.test("Ogmios rejects unsupported ledger protocol versions", async () => {
  const fetch = globalThis.fetch;
  try {
    for (const major of [undefined, 10, 12]) {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(JSON.stringify({ result: { version: { major } } })),
        );
      await assertRejects(
        () => queryProtocolParametersCompat("http://ogmios.invalid"),
        Error,
        "protocol version 11 is required",
      );
    }
  } finally {
    globalThis.fetch = fetch;
  }
});
