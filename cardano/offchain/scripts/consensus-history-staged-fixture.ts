import { assert, assertEquals } from "@std/assert";
import {
  CML,
  Constr,
  Data,
  type LucidEvolution,
  type TxBuilder,
  type UTxO,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import type { Emulator } from "@lucid-evolution/provider";
import { createHash } from "node:crypto";
import { selectTendermintQuorumWitnesses } from "../../gateway/src/tx/tendermint-quorum-witnesses.ts";
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
  batchSize?: number;
  resourcePercent?: number;
  quorumWitnesses?: boolean;
  forceGeneral?: boolean;
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
  const singleSet = !args.forceGeneral && (adjacent ||
    tmHeader.fields[7] === trustedConsensus.fields[1]);
  assert(validators.length <= 256 && trusted.length <= 256);
  const votingValidator = (value: Constr<Data>) => ({
    pubkey: value.fields[1] as string,
    votingPower: value.fields[2] as bigint,
  });
  const trust = clientState.fields[1] as Constr<Data>;
  const selected = args.quorumWitnesses === false
    ? undefined
    : selectTendermintQuorumWitnesses({
      targetValidators: validators.map(votingValidator),
      commitSignatures: signatures.map((value) => ({
        block_id_flag: value.fields[0] as bigint,
      })),
      trustedValidators: singleSet ? undefined : trusted.map(votingValidator),
      trustLevel: {
        numerator: trust.fields[0] as bigint,
        denominator: trust.fields[1] as bigint,
      },
      requireSingleSetTrust: singleSet && !adjacent,
      preserveEvidenceQuorum: adjacent,
    });
  let signatureCount = 0;
  let membershipCount = 0;
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
    singleSet ? 0n : BigInt(trusted.length),
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
  const referenceFor = (hash: string) => {
    const matching = references.filter((utxo) =>
      utxo.scriptRef && validatorToScriptHash(utxo.scriptRef) === hash
    );
    assertEquals(matching.length, 1, "Expected one matching session reference");
    return matching[0];
  };
  const mintReference = referenceFor(scripts.sessionMint.policyId);
  const spendReference = referenceFor(scripts.sessionSpend.scriptHash);
  let phase = singleSet
    ? constr([emptyAccumulator(), 0n, 0n, none()])
    : constr([emptyAccumulator(), 0n, none()], 1);
  const datum = () => encode(constr([token, owner, plan, phase]));
  const measurements: Array<
    {
      operation: string;
      bytes: number;
      memory: number;
      steps: number;
      fee: number;
    }
  > = [];
  const resourcePercent = BigInt(args.resourcePercent ?? 95);
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
      units.mem() <= BigInt(parameters.maxTxExMem) * resourcePercent / 100n,
      `${operation}: ${units.mem()} memory`,
    );
    assert(
      units.steps() <= BigInt(parameters.maxTxExSteps) * resourcePercent / 100n,
      `${operation}: ${units.steps()} CPU`,
    );
    assertEquals(await signed.submit(), signed.toHash());
    emulator.awaitBlock();
    measurements.push({
      operation,
      fee: Number(signed.toTransaction().body().fee()),
      bytes,
      memory: Number(units.mem()),
      steps: Number(units.steps()),
    });
    const output = await lucid.utxoByUnit(unit);
    assertEquals(output.datum, datum());
    return output;
  }
  let utxo = await submit(
    lucid.newTx().readFrom([mintReference])
      .collectFrom([seed])
      .mintAssets({ [unit]: 1n }, encode(constr([seedRef, owner, plan])))
      .pay.ToContract(scripts.sessionSpend.address, {
        kind: "inline",
        value: datum(),
      }, { [unit]: 1n, lovelace: 0n }),
    "session initialize",
  );
  function accumulator(values: Constr<Data>[]) {
    const peaks: { size: bigint; root: string }[] = [];
    for (const value of values) {
      let next = { size: 1n, root: validatorLeaf(value) };
      while (peaks[0]?.size === next.size) {
        const previous = peaks.shift()!;
        next = {
          size: next.size * 2n,
          root: sha256("01" + previous.root + next.root),
        };
      }
      peaks.unshift(next);
    }
    return constr([
      BigInt(values.length),
      peaks.map((p) => constr([p.size, p.root])),
    ]);
  }
  const total = (values: Constr<Data>[]) =>
    values.reduce((sum, value) => sum + (value.fields[2] as bigint), 0n);
  const last = (values: Constr<Data>[]) => {
    const value = values.at(-1)!;
    return some(constr([value.fields[2], value.fields[0]]));
  };
  const batchSize = args.batchSize ?? 6;
  const trustedLeaves = trusted.map(validatorLeaf);
  const trustedRoot = root(trustedLeaves);
  const trustedTotal = total(trusted);
  if (!singleSet) {
    for (let offset = 0; offset < trusted.length; offset += batchSize) {
      const batch = trusted.slice(offset, offset + batchSize);
      const prefix = trusted.slice(0, offset + batch.length);
      phase = prefix.length === trusted.length
        ? constr([
          trustedRoot,
          trustedTotal,
          emptyAccumulator(),
          0n,
          0n,
          0n,
          0n,
          none(),
        ], 2)
        : constr([accumulator(prefix), total(prefix), last(prefix)], 1);
      utxo = await submit(
        lucid.newTx().readFrom([spendReference])
          .collectFrom([utxo], encode(constr([batch])))
          .pay.ToContract(scripts.sessionSpend.address, {
            kind: "inline",
            value: datum(),
          }, utxo.assets),
        "session verify trusted",
      );
    }
  }
  let signedPower = 0n;
  let trustedSigned = 0n;
  let used = 0n;
  const targetBatchSize = singleSet ? batchSize : Math.min(batchSize, 6);
  for (let offset = 0; offset < validators.length; offset += targetBatchSize) {
    const values = validators.slice(offset, offset + targetBatchSize);
    const entries = values.map((validator, j) => {
      const entryIndex = offset + j;
      const sig = !selected || selected.signatures.has(entryIndex)
        ? signatures[entryIndex]
        : constr([1n, "", 0n, ""]);
      let membership: Constr<Data> = none();
      if (sig.fields[0] === 2n) {
        signatureCount++;
        signedPower += validator.fields[2] as bigint;
        if (!singleSet) {
          const index = trusted.findIndex((value) =>
            value.fields[1] === validator.fields[1]
          );
          if (
            index >= 0 && (!selected || selected.memberships.has(entryIndex))
          ) {
            membershipCount++;
            trustedSigned += trusted[index].fields[2] as bigint;
            used |= 1n << BigInt(index);
            membership = some(
              constr([
                BigInt(index),
                trusted[index],
                auditPath(trustedLeaves, index),
              ]),
            );
          }
        }
      }
      return constr([validator, sig, membership]);
    });
    const prefix = validators.slice(0, offset + values.length);
    phase = prefix.length === validators.length
      ? constr([
        root(prefix.map(validatorLeaf)),
        total(prefix),
        signedPower,
        adjacent ? none() : some(trustedRoot),
        adjacent ? 0n : trustedTotal,
        singleSet && !adjacent ? signedPower : trustedSigned,
      ], 3)
      : singleSet
      ? constr([accumulator(prefix), total(prefix), signedPower, last(prefix)])
      : constr([
        trustedRoot,
        trustedTotal,
        accumulator(prefix),
        total(prefix),
        signedPower,
        trustedSigned,
        used,
        last(prefix),
      ], 2);
    utxo = await submit(
      lucid.newTx().readFrom([spendReference])
        .collectFrom([utxo], encode(constr([entries], 1)))
        .pay.ToContract(scripts.sessionSpend.address, {
          kind: "inline",
          value: datum(),
        }, utxo.assets),
      "session verify target",
    );
  }
  return {
    utxo,
    token,
    measurements,
    witnesses: { signatures: signatureCount, memberships: membershipCount },
    finalize(builder: TxBuilder) {
      return builder.readFrom([mintReference, spendReference]).collectFrom(
        [utxo],
        encode(constr([], 2)),
      )
        .mintAssets({ [unit]: -1n }, encode(constr([name], 1)))
        .addSignerKey(owner);
    },
  };
}
