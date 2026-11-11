import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const digest = (hex: string) =>
  createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const leaf = (value: string) => digest(`00${value}`);
const inner = (left: string, right: string) => digest(`01${left}${right}`);

/** Compact peaks, smallest subtree first. Only used by the experiment. */
export class Archive {
  values: string[] = [];
  peaks: string[] = [];

  root(): string {
    let hash = this.peaks[0] ?? digest("");
    for (const peak of this.peaks.slice(1)) hash = inner(peak, hash);
    return `02${this.values.length.toString(16).padStart(16, "0")}${hash}`;
  }

  append(value: string): void {
    let count = this.values.length;
    let hash = leaf(value);
    while (count % 2 === 1) {
      hash = inner(this.peaks.shift()!, hash);
      count = Math.floor(count / 2);
    }
    this.peaks.unshift(hash);
    this.values.push(value);
  }

  proof(position: number): string[] {
    if (
      !Number.isInteger(position) || position < 0 ||
      position >= this.values.length
    ) {
      throw new Error("Invalid archive position");
    }
    const walk = (values: string[], index: number): string[] => {
      if (values.length === 1) return [];
      const boundary = 2 ** Math.floor(Math.log2(values.length - 1));
      return index < boundary
        ? [
          ...walk(values.slice(0, boundary), index),
          fullRoot(values.slice(boundary)),
        ]
        : [
          ...walk(values.slice(boundary), index - boundary),
          fullRoot(values.slice(0, boundary)),
        ];
    };
    return walk(this.values, position);
  }
}

/** Separate full-tree construction, with no frontier or append operations. */
export function fullRoot(values: string[]): string {
  if (!values.length) return digest("");
  if (values.length === 1) return leaf(values[0]);
  const boundary = 2 ** Math.floor(Math.log2(values.length - 1));
  return inner(
    fullRoot(values.slice(0, boundary)),
    fullRoot(values.slice(boundary)),
  );
}
