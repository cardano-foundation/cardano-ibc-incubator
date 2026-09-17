import {
  CML,
  coreToUtxo,
  type LucidEvolution,
  type TxSigned,
  type UTxO,
} from "@lucid-evolution/lucid";
import { join } from "@std/path";

type Anchor = { txHash: string; outputIndex: number };
/** Build only after all prior signed revisions have been reconciled. Every
 * replacement must spend revision zero's normal input, never its change. */
export type MigrationBuild = {
  anchor?: Anchor;
  build: (anchor?: UTxO) => Promise<TxSigned>;
};
export type MigrationSubmit = (
  request: TxSigned | MigrationBuild,
  action: string,
) => Promise<string>;
type JournalEntry = {
  format: "cardano-ibc-signed-migration-v2";
  action: string;
  revision: number;
  parent: string | null;
  anchor: Anchor;
  hash: string;
  cbor: string;
};

function inputs(tx: CML.Transaction): Anchor[] {
  const result: Anchor[] = [];
  for (let i = 0; i < tx.body().inputs().len(); i++) {
    const input = tx.body().inputs().get(i);
    result.push({
      txHash: input.transaction_id().to_hex(),
      outputIndex: Number(input.index()),
    });
  }
  return result;
}
function sameAnchor(a: Anchor, b: Anchor) {
  return a.txHash === b.txHash && a.outputIndex === b.outputIndex;
}

/** Public signed bytes are fsynced before broadcasting. Exclusive immutable
 * revision files serialize executors sharing this outbox. Canonical chain
 * observations, not these files, establish adoption. Replacements are safe
 * across rollback because every revision spends the same original input.
 * Use one shared durable outbox per publication plan; separate outboxes cannot
 * provide cross-process publication deduplication. */
export function migrationSubmitter(
  lucid: LucidEvolution,
  directory: string,
  report: (value: unknown) => void = console.log,
  attempts = 3,
  currentSlot?: () => Promise<bigint>,
): MigrationSubmit {
  return async (request, action) => {
    if (!/^[a-zA-Z0-9:_-]+$/.test(action)) {
      throw new Error("Invalid migration journal action");
    }
    await Deno.mkdir(directory, { recursive: true });
    const lazy = "build" in request ? request : undefined;
    const provider = lucid.config().provider as
      & NonNullable<ReturnType<typeof lucid.config>["provider"]>
      & { getTransactionOutputs?(hash: string): Promise<UTxO[]> };
    if (!provider) throw new Error("Migration requires a provider");
    const pathFor = (revision: number) =>
      join(directory, `${action}${revision ? `.r${revision}` : ""}.json`);
    const read = async (): Promise<JournalEntry[]> => {
      const entries: JournalEntry[] = [];
      for (let revision = 0; revision < 1000; revision++) {
        const path = pathFor(revision);
        let entry: JournalEntry;
        try {
          entry = JSON.parse(await Deno.readTextFile(path));
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) return entries;
          throw new Error(
            `Corrupt migration submission journal ${path}: ${error}`,
          );
        }
        try {
          const tx = CML.Transaction.from_cbor_hex(entry.cbor);
          if (
            entry.format !== "cardano-ibc-signed-migration-v2" ||
            entry.action !== action || entry.revision !== revision ||
            entry.parent !== (entries.at(-1)?.hash ?? null) ||
            CML.hash_transaction(tx.body()).to_hex() !== entry.hash ||
            !entry.anchor || !inputs(tx).some((i) =>
              sameAnchor(i, entry.anchor)
            ) ||
            (revision > 0 && !sameAnchor(entries[0].anchor, entry.anchor)) ||
            (lazy?.anchor && !sameAnchor(lazy.anchor, entry.anchor))
          ) throw new Error("identity, hash, parent or anchor mismatch");
        } catch (error) {
          throw new Error(
            `Corrupt migration submission journal ${path}: ${error}`,
          );
        }
        entries.push(entry);
      }
      throw new Error("Migration submission exceeds 1000 immutable revisions");
    };
    const observed = async (entry: JournalEntry) => {
      const tx = CML.Transaction.from_cbor_hex(entry.cbor);
      const expected: UTxO[] = [];
      for (let index = 0; index < tx.body().outputs().len(); index++) {
        expected.push(coreToUtxo(CML.TransactionUnspentOutput.new(
          CML.TransactionInput.new(
            CML.TransactionHash.from_hex(entry.hash),
            BigInt(index),
          ),
          tx.body().outputs().get(index),
        )));
      }
      const outputs = provider.getTransactionOutputs
        ? await provider.getTransactionOutputs(entry.hash)
        : await lucid.utxosByOutRef(expected);
      return expected.length > 0 &&
        expected.every((want) =>
          outputs.some((got) =>
            got.outputIndex === want.outputIndex && got.txHash === entry.hash &&
            got.address === want.address && got.datum === want.datum &&
            got.datumHash === want.datumHash &&
            got.scriptRef?.type === want.scriptRef?.type &&
            got.scriptRef?.script === want.scriptRef?.script &&
            Object.keys(got.assets).length ===
              Object.keys(want.assets).length &&
            Object.entries(want.assets).every(([unit, amount]) =>
              got.assets[unit] === amount
            )
          )
        );
    };
    const adopted = async (entries: JournalEntry[]) => {
      // A rollback can select an earlier revision, even after a replacement
      // was signed. Never reconcile only the newest local record.
      for (const entry of entries) if (await observed(entry)) return entry.hash;
      return undefined;
    };
    const publish = async (entry: JournalEntry) => {
      const temporary = await Deno.makeTempFile({
        dir: directory,
        prefix: ".signed-",
      });
      try {
        const file = await Deno.open(temporary, { write: true, mode: 0o600 });
        try {
          const bytes = new TextEncoder().encode(JSON.stringify(entry) + "\n");
          let offset = 0;
          while (offset < bytes.length) {
            offset += await file.write(bytes.subarray(offset));
          }
          await file.sync();
        } finally {
          file.close();
        }
        await Deno.link(temporary, pathFor(entry.revision));
        const parent = await Deno.open(directory, { read: true });
        try {
          await parent.sync();
        } finally {
          parent.close();
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
        // A competing executor won. Caller reloads and broadcasts only the
        // winner, never the transaction built by this losing process.
      } finally {
        await Deno.remove(temporary);
      }
    };

    let entries = await read();
    let accepted = await adopted(entries);
    if (accepted) return accepted;
    let latest = entries.at(-1);
    let expired = false;
    if (latest && currentSlot) {
      const ttl = CML.Transaction.from_cbor_hex(latest.cbor).body().ttl();
      expired = ttl !== undefined && (await currentSlot()) > ttl;
    }
    if (!latest || expired) {
      if (expired && !lazy) {
        throw new Error(
          `Signed migration ${
            latest!.hash
          } expired; this action needs a lazy builder with its original input anchor`,
        );
      }
      let anchor: UTxO | undefined;
      const pinned = entries[0]?.anchor ?? lazy?.anchor;
      if (pinned) {
        [anchor] = await lucid.utxosByOutRef([pinned]);
        if (!anchor) {
          accepted = await adopted(await read());
          if (accepted) return accepted;
          throw new Error(
            "Original migration input is not canonically unspent; synchronize history and inspect all journal revisions before retrying",
          );
        }
      }
      const signed = lazy ? await lazy.build(anchor) : request as TxSigned;
      const tx = CML.Transaction.from_cbor_hex(signed.toCBOR());
      const selected = pinned ?? inputs(tx)[0];
      if (!selected || !inputs(tx).some((i) => sameAnchor(i, selected))) {
        throw new Error(
          "Migration replacement omitted its original normal input anchor",
        );
      }
      if (lazy && tx.body().ttl() === undefined) {
        throw new Error(
          "Resumable migration publication requires a finite transaction expiry",
        );
      }
      // Reconcile again after potentially slow construction/signing.
      entries = await read();
      accepted = await adopted(entries);
      if (accepted) return accepted;
      const nextRevision = latest ? latest.revision + 1 : 0;
      if (entries.length === nextRevision) {
        await publish({
          format: "cardano-ibc-signed-migration-v2",
          action,
          revision: nextRevision,
          parent: latest?.hash ?? null,
          anchor: selected,
          hash: signed.toHash(),
          cbor: signed.toCBOR(),
        });
      }
      entries = await read();
      latest = entries.at(-1);
    }
    if (!latest) throw new Error("No signed migration journal revision");
    report({
      action,
      transaction: latest.hash,
      journal: pathFor(latest.revision),
      revision: latest.revision,
      anchor: latest.anchor,
      status: "signed; submission/adoption not yet established",
    });
    let last: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      accepted = await adopted(entries);
      if (accepted) return accepted;
      // A competing process may have linked the winning revision immediately
      // before this process read it. Flush the shared directory ourselves before
      // any broadcast; do not depend on the winner reaching its own fsync.
      const journalDirectory = await Deno.open(directory, { read: true });
      try {
        await journalDirectory.sync();
      } finally {
        journalDirectory.close();
      }
      try {
        const hash = await provider.submitTx(latest.cbor);
        if (hash !== latest.hash) {
          throw new Error("Provider returned a different transaction hash");
        }
      } catch (error) {
        last = error;
      }
      try {
        await lucid.awaitTx(latest.hash);
      } catch (error) {
        last = error;
      }
      accepted = await adopted(entries);
      if (accepted) return accepted;
    }
    throw new Error(
      `Submission ${latest.hash} remains unresolved. Keep ${
        pathFor(latest.revision)
      }; inspect canonical state and retry this action with the same journal. Do not assume failure or create another publication. Last error: ${last}`,
    );
  };
}
