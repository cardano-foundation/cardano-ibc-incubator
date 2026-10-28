import { CML, coreToUtxo, type UTxO, utxoToCore } from "@lucid-evolution/lucid";

export interface CostRole {
  name: string;
  wallet?: boolean;
  controller: string;
  recoveryRecipient: string;
  recoveryCondition: string;
  principalLovelace?: bigint;
}

type CostOutput = {
  ref: string;
  address: string;
  assets: Record<string, bigint>;
  datum?: string;
  role: CostRole;
  lovelace: bigint;
  minimumLovelace: bigint;
  principalLovelace: bigint;
};

export type CostMeasurement = ReturnType<typeof measureTransaction>;

const reference = (u: Pick<UTxO, "txHash" | "outputIndex">) =>
  `${u.txHash}#${u.outputIndex}`;
const sum = <T>(items: T[], value: (item: T) => bigint) =>
  items.reduce((total, item) => total + value(item), 0n);

/** Successful ordinary UTxO transactions only. Certificate deposits, withdrawals
 * and other ledger-side ADA flows must be accounted for separately.
 */
export function measureTransaction(
  cbor: string,
  resolvedInputs: UTxO[],
  resolvedCollateral: UTxO[],
  coinsPerUtxoByte: bigint,
  classify: (utxo: UTxO, direction: "input" | "output") => CostRole,
) {
  const tx = CML.Transaction.from_cbor_hex(cbor);
  if (!tx.is_valid()) {
    throw new Error(
      "Failed-script collateral accounting is a separate scenario",
    );
  }
  if (coinsPerUtxoByte <= 0n) throw new Error("Invalid UTxO cost parameter");
  const body = tx.body();
  const hash = CML.hash_transaction(body).to_hex();
  const resolve = (
    refs: CML.TransactionInputList | undefined,
    available: UTxO[],
  ) => {
    const byRef = new Map(available.map((u) => [reference(u), u]));
    if (
      byRef.size !== available.length || available.length !== (refs?.len() ?? 0)
    ) {
      throw new Error("Resolved inputs must match transaction inputs exactly");
    }
    const selected: UTxO[] = [];
    for (let index = 0; refs && index < refs.len(); index++) {
      const input = refs.get(index);
      const key = `${input.transaction_id().to_hex()}#${input.index()}`;
      const value = byRef.get(key);
      if (!value) throw new Error(`Missing resolved input ${key}`);
      selected.push(value);
      byRef.delete(key);
    }
    return selected;
  };
  const inputs = resolve(body.inputs(), resolvedInputs);
  const collateral = resolve(body.collateral_inputs(), resolvedCollateral);
  const describe = (u: UTxO, direction: "input" | "output"): CostOutput => {
    const role = classify(u, direction);
    const principal = role.principalLovelace ?? 0n;
    if (!role.name || principal < 0n || principal > u.assets.lovelace) {
      throw new Error("Invalid principal allocation or output role");
    }
    return {
      ref: reference(u),
      address: u.address,
      assets: u.assets,
      datum: u.datum ?? undefined,
      role,
      lovelace: u.assets.lovelace,
      minimumLovelace: CML.min_ada_required(
        utxoToCore(u).output(),
        coinsPerUtxoByte,
      ),
      principalLovelace: principal,
    };
  };
  const inputRows = inputs.map((u) => describe(u, "input"));
  const outputRows: CostOutput[] = [];
  for (let index = 0; index < body.outputs().len(); index++) {
    const output = coreToUtxo(CML.TransactionUnspentOutput.new(
      CML.TransactionInput.new(
        CML.TransactionHash.from_hex(hash),
        BigInt(index),
      ),
      body.outputs().get(index),
    ));
    const row = describe(output, "output");
    if (row.lovelace < row.minimumLovelace) {
      throw new Error("Output is below ledger minimum ADA");
    }
    outputRows.push(row);
  }
  const fee = body.fee();
  const inputTotal = sum(inputRows, (u) => u.lovelace);
  const outputTotal = sum(outputRows, (u) => u.lovelace);
  if (inputTotal - outputTotal !== fee) {
    throw new Error(
      "ADA does not reconcile. Resolve every input and account for any non-UTxO ledger flows separately",
    );
  }
  const roles = new Map<string, {
    wallet: boolean;
    inputLovelace: bigint;
    outputLovelace: bigint;
    netDebitLovelace: bigint;
    netPrincipalIncreaseLovelace: bigint;
    netReserveIncreaseLovelace: bigint;
    minimumReserveIncreaseLovelace: bigint;
  }>();
  for (
    const [direction, rows] of [[-1n, inputRows], [1n, outputRows]] as const
  ) {
    for (const row of rows) {
      const role = roles.get(row.role.name) ?? {
        wallet: row.role.wallet === true,
        inputLovelace: 0n,
        outputLovelace: 0n,
        netDebitLovelace: 0n,
        netPrincipalIncreaseLovelace: 0n,
        netReserveIncreaseLovelace: 0n,
        minimumReserveIncreaseLovelace: 0n,
      };
      if (role.wallet !== (row.role.wallet === true)) {
        throw new Error(
          "Inconsistent wallet role",
        );
      }
      if (direction === -1n) role.inputLovelace += row.lovelace;
      else role.outputLovelace += row.lovelace;
      role.netDebitLovelace -= direction * row.lovelace;
      role.netPrincipalIncreaseLovelace += direction * row.principalLovelace;
      role.netReserveIncreaseLovelace += direction *
        (row.lovelace - row.principalLovelace);
      const minimumReserve = row.minimumLovelace > row.principalLovelace
        ? row.minimumLovelace - row.principalLovelace
        : 0n;
      role.minimumReserveIncreaseLovelace += direction * minimumReserve;
      roles.set(row.role.name, role);
    }
  }
  const units = tx.witness_set().redeemers();
  const execution = units ? CML.compute_total_ex_units(units) : undefined;
  return {
    transaction: hash,
    transactionCbor: cbor,
    signedSizeBytes: cbor.length / 2,
    feeLovelace: fee,
    memory: execution?.mem() ?? 0n,
    cpu: execution?.steps() ?? 0n,
    inputLovelace: inputTotal,
    outputLovelace: outputTotal,
    reconciliationDifferenceLovelace: inputTotal - outputTotal - fee,
    inputs: inputRows,
    outputs: outputRows,
    roles: Object.fromEntries(roles),
    collateral: {
      inputs: collateral,
      reservedLovelace: sum(collateral, (u) => u.assets.lovelace),
      declaredLovelace: body.total_collateral() ?? 0n,
      returnLovelace: body.collateral_return()?.amount().coin() ?? 0n,
      consumedLovelace: 0n,
      note:
        "Collateral and collateral return are excluded from successful transaction value flows",
    },
  };
}

export interface CostProfile {
  name: string;
  relayerNetDebitLovelace: bigint;
  relayerFeesLovelace: bigint;
  recipientTopUpLovelace: bigint;
  protocolReserveIncreaseLovelace: bigint;
  collateralLovelace: bigint;
}

/** Cash needed for the supplied workload. Reimbursement is a declared external
 * arrangement, never inferred from a script's ability to release ADA.
 */
export function projectFunding(
  profiles: CostProfile[],
  executionsPerDay: Record<string, number>,
  options: {
    days: number;
    concurrency: number;
    spendableReserveLovelace: bigint;
    upfrontLovelace?: bigint;
    reimbursementPerDayLovelace?: bigint;
    reimbursementDelayDays?: number;
  },
) {
  const integer = (value: number, positive = false) =>
    Number.isSafeInteger(value) && value >= (positive ? 1 : 0);
  if (
    !integer(options.days, true) || !integer(options.concurrency, true) ||
    !integer(options.reimbursementDelayDays ?? 0) ||
    options.spendableReserveLovelace < 0n ||
    (options.upfrontLovelace ?? 0n) < 0n ||
    (options.reimbursementPerDayLovelace ?? 0n) < 0n
  ) {
    throw new Error("Invalid funding assumptions");
  }
  const byName = new Map(profiles.map((p) => [p.name, p]));
  if (byName.size !== profiles.length) {
    throw new Error("Duplicate cost profile");
  }
  let dailyDebit = 0n,
    dailyFees = 0n,
    dailyTopUps = 0n,
    dailyProtocol = 0n,
    collateral = 0n;
  for (const [name, count] of Object.entries(executionsPerDay)) {
    const profile = byName.get(name);
    if (!profile || !integer(count)) {
      throw new Error(`Invalid workload ${name}`);
    }
    dailyDebit += profile.relayerNetDebitLovelace * BigInt(count);
    dailyFees += profile.relayerFeesLovelace * BigInt(count);
    dailyTopUps += profile.recipientTopUpLovelace * BigInt(count);
    dailyProtocol += profile.protocolReserveIncreaseLovelace * BigInt(count);
    if (count > 0 && profile.collateralLovelace > collateral) {
      collateral = profile.collateralLovelace;
    }
  }
  const reimburse = options.reimbursementPerDayLovelace ?? 0n;
  const delay = options.reimbursementDelayDays ?? 0;
  let cash = options.upfrontLovelace ?? 0n, peak = cash;
  const series = [];
  for (let day = 1; day <= options.days; day++) {
    // Payments must be funded before that day's reimbursement arrives.
    cash += dailyDebit;
    if (cash > peak) peak = cash;
    const received = day > delay ? reimburse : 0n;
    cash -= received;
    series.push({
      day,
      netFundingConsumedLovelace: cash,
      reimbursementLovelace: received,
    });
  }
  const collateralReserve = collateral * BigInt(options.concurrency);
  return {
    assumptions: { executionsPerDay, ...options },
    collateralPolicy:
      "Conservative dedicated collateral inputs for each concurrent transaction, using the observed wallet UTxO shape",
    dailyRelayerNetDebitLovelace: dailyDebit,
    dailyRelayerFeesLovelace: dailyFees,
    dailyRecipientTopUpLovelace: dailyTopUps,
    dailyProtocolReserveIncreaseLovelace: dailyProtocol,
    collateralReserveLovelace: collateralReserve,
    peakFundingLovelace: peak + collateralReserve +
      options.spendableReserveLovelace,
    reimbursementReceivableLovelace: reimburse *
      BigInt(Math.min(delay, options.days)),
    netFundingConsumedLovelace: cash,
    days: series,
  };
}

export const stringifyCosts = (value: unknown, indentation = 2) =>
  JSON.stringify(
    value,
    (_, item) => typeof item === "bigint" ? item.toString() : item,
    indentation,
  ) + "\n";
