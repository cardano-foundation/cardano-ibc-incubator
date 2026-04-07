import { sha256 } from 'js-sha256';

const MERKLE_DEPTH_BITS = 64;
const HASH_SIZE_BYTES = 32;
const EMPTY_HASH = Buffer.alloc(HASH_SIZE_BYTES, 0);

function sha256Bytes(data: Buffer): Buffer {
  return Buffer.from(sha256.array(data));
}

function leafHash(value: Buffer): Buffer {
  if (value.length === 0) {
    return EMPTY_HASH;
  }

  const valueHash = sha256Bytes(value);
  return sha256Bytes(Buffer.concat([Buffer.from([0x00]), valueHash]));
}

function innerHash(left: Buffer, right: Buffer): Buffer {
  if (left.equals(EMPTY_HASH) && right.equals(EMPTY_HASH)) {
    return EMPTY_HASH;
  }

  return sha256Bytes(Buffer.concat([Buffer.from([0x01]), left, right]));
}

function keyIndex64(key: string): bigint {
  const keyHash = sha256Bytes(Buffer.from(key, 'utf8'));
  const first8 = keyHash.subarray(0, 8);
  return BigInt(`0x${first8.toString('hex')}`);
}

export class ICS23MerkleTree {
  private leaves: Map<string, Buffer> = new Map();
  private root: Buffer = EMPTY_HASH;
  private dirty = true;
  private nodesByHeight: Array<Map<bigint, Buffer>> | null = null;

  clone(): ICS23MerkleTree {
    const cloned = new ICS23MerkleTree();
    for (const [key, value] of this.leaves) {
      cloned.leaves.set(key, Buffer.from(value));
    }
    cloned.dirty = true;
    return cloned;
  }

  set(key: string, value: Buffer | string): void {
    const valueBuffer = typeof value === 'string'
      ? Buffer.from(value, 'hex')
      : value;

    if (valueBuffer.length === 0) {
      this.leaves.delete(key);
    } else {
      this.leaves.set(key, valueBuffer);
    }

    this.dirty = true;
  }

  getRoot(): string {
    this.ensureRebuilt();
    return this.root.toString('hex');
  }

  getSiblings(key: string): Buffer[] {
    this.ensureRebuilt();

    const siblings: Buffer[] = [];
    let index = keyIndex64(key);

    for (let height = 0; height < MERKLE_DEPTH_BITS; height += 1) {
      const siblingIndex = index ^ 1n;
      const siblingHash = this.nodesByHeight![height].get(siblingIndex) ?? EMPTY_HASH;
      siblings.push(Buffer.from(siblingHash));
      index >>= 1n;
    }

    return siblings;
  }

  private ensureRebuilt(): void {
    if (!this.dirty) {
      return;
    }

    const nodesByHeight: Array<Map<bigint, Buffer>> = Array.from(
      { length: MERKLE_DEPTH_BITS + 1 },
      () => new Map<bigint, Buffer>(),
    );

    for (const [key, value] of this.leaves.entries()) {
      nodesByHeight[0].set(keyIndex64(key), leafHash(value));
    }

    for (let height = 0; height < MERKLE_DEPTH_BITS; height += 1) {
      const currentLevel = nodesByHeight[height];
      const parentLevel = nodesByHeight[height + 1];
      const parentIndexes = new Set<bigint>();

      for (const index of currentLevel.keys()) {
        parentIndexes.add(index >> 1n);
      }

      for (const parentIndex of parentIndexes) {
        const left = currentLevel.get(parentIndex << 1n) ?? EMPTY_HASH;
        const right = currentLevel.get((parentIndex << 1n) | 1n) ?? EMPTY_HASH;
        const parentHash = innerHash(left, right);
        if (!parentHash.equals(EMPTY_HASH)) {
          parentLevel.set(parentIndex, parentHash);
        }
      }
    }

    this.nodesByHeight = nodesByHeight;
    this.root = nodesByHeight[MERKLE_DEPTH_BITS].get(0n) ?? EMPTY_HASH;
    this.dirty = false;
  }
}
