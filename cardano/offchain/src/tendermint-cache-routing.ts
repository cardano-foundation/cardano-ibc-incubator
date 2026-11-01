import { CML, type TxSigned } from "@lucid-evolution/lucid";

export interface UpdateLimits {
  maxTxSize: number;
  maxTxExMem: number | bigint;
  maxTxExSteps: number | bigint;
}
export interface UpdateMeasurement {
  signedBytes: number;
  memory: number;
  steps: number;
}

/** Limits apply to the complete signed transaction, including every redeemer. */
export function evaluatedUpdateBudget(
  transaction: TxSigned,
  limits: UpdateLimits,
  headroomPercent = 5,
) {
  if (
    !Number.isInteger(headroomPercent) || headroomPercent < 0 ||
    headroomPercent >= 100
  ) {
    throw new Error("Invalid cached-update headroom");
  }
  const redeemers = transaction.toTransaction().witness_set().redeemers();
  if (!redeemers || redeemers.to_flat_format().len() === 0) {
    throw new Error("Expected evaluated script redeemers");
  }
  const units = CML.compute_total_ex_units(redeemers);
  if (units.mem() <= 0n || units.steps() <= 0n) {
    throw new Error("Expected nonzero evaluated script budgets");
  }
  const measured: UpdateMeasurement = {
    signedBytes: transaction.toCBOR().length / 2,
    memory: Number(units.mem()),
    steps: Number(units.steps()),
  };
  const hard = {
    signedBytes: limits.maxTxSize,
    memory: Number(limits.maxTxExMem),
    steps: Number(limits.maxTxExSteps),
  };
  const withinLedger = Object.keys(hard).every((key) =>
    measured[key as keyof UpdateMeasurement] <=
      hard[key as keyof UpdateMeasurement]
  );
  const exceeded = Object.keys(hard).filter((key) =>
    measured[key as keyof UpdateMeasurement] >
      Math.floor(
        hard[key as keyof UpdateMeasurement] * (100 - headroomPercent) / 100,
      )
  );
  return {
    measured,
    withinLedger,
    headroomPercent,
    exceeded,
    fits: exceeded.length === 0,
  };
}

export type EvaluatedUpdateBudget = ReturnType<typeof evaluatedUpdateBudget>;

/** Factories must use actual compiled-script evaluation. This prepares and
 * signs candidates but never submits an over-budget direct transaction. */
export async function prepareCachedUpdate(args: {
  direct: () => Promise<TxSigned>;
  staged: () => Promise<TxSigned>;
  limits: UpdateLimits;
  headroomPercent?: number;
}) {
  let direct: TxSigned | undefined;
  let directFailure: string | undefined;
  try {
    direct = await args.direct();
  } catch (error) {
    // CML can reject size before an evaluated, signed candidate exists.
    // Script failures and other builder errors must remain visible.
    const message = error instanceof Error ? error.message : String(error);
    if (!/max(?:imum)? transaction size[^\n]*exceeded/i.test(message)) {
      throw error;
    }
    directFailure = message;
  }
  const directBudget = direct
    ? evaluatedUpdateBudget(direct, args.limits, args.headroomPercent)
    : undefined;
  if (direct && directBudget?.fits) {
    return {
      path: "direct" as const,
      transaction: direct,
      directBudget,
      selectedBudget: directBudget,
    };
  }
  const staged = await args.staged();
  const stagedBudget = evaluatedUpdateBudget(
    staged,
    args.limits,
    args.headroomPercent,
  );
  if (!stagedBudget.fits) {
    throw new Error(
      `Staged finalization exceeds complete-transaction budgets: ${
        stagedBudget.exceeded.join(", ")
      }`,
    );
  }
  return {
    path: "staged" as const,
    transaction: staged,
    directBudget,
    directFailure,
    selectedBudget: stagedBudget,
  };
}
