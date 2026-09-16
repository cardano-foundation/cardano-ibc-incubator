import { assert, assertEquals } from "@std/assert";
import {
  CML,
  Constr,
  Data,
  type LucidEvolution,
  type TxBuilder,
  type UTxO,
} from "@lucid-evolution/lucid";
import type { Emulator } from "@lucid-evolution/provider";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import type { loadStagedTendermintValidators } from "../src/deployment-plan.ts";
import { serialisePlutusData } from "../src/plutus_serialise.ts";
import parameters from "./fixtures/mainnet-protocol-parameters.json" with {
  type: "json",
};

const constr = (fields: Data[], index = 0) => new Constr<Data>(index, fields);
const none = () => constr([], 1);
const some = (value: Data) => constr([value]);
const emptyAccumulator = () => constr([0n, []]);
const encode = (value: Data) => Data.to(value);
const sha256 = (hex: string) =>
  createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const sha3 = (hex: string) =>
  createHash("sha3-256").update(Buffer.from(hex, "hex")).digest("hex");
const domain = Buffer.from("cardano-ibc/tendermint-update-session/v1").toString(
  "hex",
);

function varint(n: bigint): string {
  const bytes: number[] = [];
  do {
    const byte = Number(n & 127n);
    n >>= 7n;
    bytes.push(byte | (n ? 128 : 0));
  } while (n);
  return Buffer.from(bytes).toString("hex");
}

function validatorLeaf(validator: Constr<Data>): string {
  return sha256(
    "00" + "0a220a20" + validator.fields[1] + "10" +
      varint(validator.fields[2] as bigint),
  );
}

function split(length: number): number {
  let pivot = 1;
  while (pivot * 2 < length) pivot *= 2;
  return pivot;
}

function root(leaves: string[]): string {
  assert(leaves.length > 0);
  if (leaves.length === 1) return leaves[0];
  const pivot = split(leaves.length);
  return sha256(
    "01" + root(leaves.slice(0, pivot)) + root(leaves.slice(pivot)),
  );
}

function auditPath(leaves: string[], index: number): string[] {
  if (leaves.length === 1) return [];
  const pivot = split(leaves.length);
  return index < pivot
    ? [root(leaves.slice(pivot)), ...auditPath(leaves.slice(0, pivot), index)]
    : [
      root(leaves.slice(0, pivot)),
      ...auditPath(leaves.slice(pivot), index - pivot),
    ];
}

/** Real signed session creation and verification; no Complete receipt is seeded. */
export async function submitHistorySession(args: {
  lucid: LucidEvolution;
  emulator: Emulator;
  scripts: ReturnType<typeof loadStagedTendermintValidators>;
  references: UTxO[];
  clientToken: Constr<Data>;
  trustedHeight: Constr<Data>;
  trustedConsensus: Constr<Data>;
  clientState: Constr<Data>;
  header: Constr<Data>;
  owner: string;
}) {
  const {
    lucid,
    emulator,
    scripts,
    references,
    clientToken,
    trustedHeight,
    trustedConsensus,
    clientState,
    header,
    owner,
  } = args;
  const [tmHeader, commit] = (header.fields[0] as Constr<Data>)
    .fields as Constr<Data>[];
  const validators = (header.fields[1] as Constr<Data>).fields[0] as Constr<
    Data
  >[];
  const trusted = (header.fields[3] as Constr<Data>).fields[0] as Constr<
    Data
  >[];
  const signatures = commit.fields[3] as Constr<Data>[];
  const adjacent =
    tmHeader.fields[2] === (trustedHeight.fields[1] as bigint) + 1n;
  assert(
    validators.length <= 6 && trusted.length <= 6,
    "Fixture uses one bounded batch per phase",
  );
  const plan = constr([
    clientToken,
    trustedHeight,
    trustedConsensus,
    clientState.fields[1],
    clientState.fields[2],
    clientState.fields[4],
    tmHeader,
    constr(commit.fields.slice(0, 3)),
    BigInt(validators.length),
    adjacent ? 0n : BigInt(trusted.length),
  ]);
  const seed = (await lucid.wallet().getUtxos()).find((utxo) =>
    !utxo.scriptRef && !utxo.datum && Object.keys(utxo.assets).length === 1
  )!;
  assert(seed);
  const seedRef = constr([seed.txHash, BigInt(seed.outputIndex)]);
  const name = sha3(
    domain + serialisePlutusData(encode(seedRef)) +
      sha3(domain + serialisePlutusData(encode(plan))),
  );
  const token = constr([scripts.sessionMint.policyId, name]);
  const unit = scripts.sessionMint.policyId + name;
  let phase = adjacent
    ? constr([emptyAccumulator(), 0n, 0n, none()])
    : constr([emptyAccumulator(), 0n, none()], 1);
  const datum = () => encode(constr([token, owner, plan, phase]));
  const measurements: Array<
    { operation: string; bytes: number; memory: number; steps: number }
  > = [];
  async function submit(builder: TxBuilder, operation: string) {
    const tx = await builder.addSignerKey(owner).complete({
      localUPLCEval: true,
    }).catch((cause) => {
      throw new Error(`Failed signed ${operation}`, { cause });
    });
    const signed = await tx.sign.withWallet().complete();
    const bytes = signed.toCBOR().length / 2;
    const units = CML.compute_total_ex_units(
      signed.toTransaction().witness_set().redeemers()!,
    );
    assert(bytes <= parameters.maxTxSize - 750, `${operation}: ${bytes} bytes`);
    assert(
      units.mem() <= BigInt(parameters.maxTxExMem) * 95n / 100n,
      `${operation}: ${units.mem()} memory`,
    );
    assert(
      units.steps() <= BigInt(parameters.maxTxExSteps) * 95n / 100n,
      `${operation}: ${units.steps()} CPU`,
    );
    assertEquals(await signed.submit(), signed.toHash());
    emulator.awaitBlock();
    measurements.push({
      operation,
      bytes,
      memory: Number(units.mem()),
      steps: Number(units.steps()),
    });
    const output = await lucid.utxoByUnit(unit);
    assertEquals(output.datum, datum());
    return output;
  }
  let utxo = await submit(
    lucid.newTx().readFrom(references)
      .collectFrom([seed])
      .mintAssets({ [unit]: 1n }, encode(constr([seedRef, owner, plan])))
      .pay.ToContract(scripts.sessionSpend.address, {
        kind: "inline",
        value: datum(),
      }, { [unit]: 1n, lovelace: 15_000_000n }),
    "session initialize",
  );
  const trustedLeaves = trusted.map(validatorLeaf);
  const trustedRoot = root(trustedLeaves);
  const trustedTotal = trusted.reduce(
    (sum, validator) => sum + (validator.fields[2] as bigint),
    0n,
  );
  if (!adjacent) {
    phase = constr([
      trustedRoot,
      trustedTotal,
      emptyAccumulator(),
      0n,
      0n,
      0n,
      0n,
      none(),
    ], 2);
    utxo = await submit(
      lucid.newTx().readFrom(references)
        .collectFrom([utxo], encode(constr([trusted])))
        .pay.ToContract(scripts.sessionSpend.address, {
          kind: "inline",
          value: datum(),
        }, utxo.assets),
      "session verify trusted",
    );
  }
  let signedPower = 0n;
  let trustedSigned = 0n;
  const entries = validators.map((validator, index) => {
    const sig = signatures[index];
    let membership: Constr<Data> = none();
    if (sig.fields[0] === 2n) {
      signedPower += validator.fields[2] as bigint;
      if (!adjacent) {
        const trustedIndex = trusted.findIndex((candidate) =>
          candidate.fields[1] === validator.fields[1]
        );
        assert(trustedIndex >= 0);
        trustedSigned += trusted[trustedIndex].fields[2] as bigint;
        membership = some(
          constr([
            BigInt(trustedIndex),
            trusted[trustedIndex],
            auditPath(trustedLeaves, trustedIndex),
          ]),
        );
      }
    }
    return constr([validator, sig, membership]);
  });
  phase = constr([
    root(validators.map(validatorLeaf)),
    validators.reduce(
      (sum, validator) => sum + (validator.fields[2] as bigint),
      0n,
    ),
    signedPower,
    adjacent ? none() : some(trustedRoot),
    adjacent ? 0n : trustedTotal,
    trustedSigned,
  ], 3);
  utxo = await submit(
    lucid.newTx().readFrom(references)
      .collectFrom([utxo], encode(constr([entries], 1)))
      .pay.ToContract(scripts.sessionSpend.address, {
        kind: "inline",
        value: datum(),
      }, utxo.assets),
    "session verify target",
  );
  return {
    utxo,
    token,
    measurements,
    finalize(builder: TxBuilder) {
      return builder.readFrom(references).collectFrom(
        [utxo],
        encode(constr([], 2)),
      )
        .mintAssets({ [unit]: -1n }, encode(constr([name], 1)))
        .addSignerKey(owner);
    },
  };
}
