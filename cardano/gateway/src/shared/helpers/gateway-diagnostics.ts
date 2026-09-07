import { constants, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const MAX_PENDING_RECORDS = 8;
const MAX_RECORD_BYTES = 64 * 1024;
const FILE_COUNT = 8;

type PendingRecord = {
  scope: string;
  createDetails: () => unknown;
};

export class GatewayDiagnostics {
  private readonly queue: PendingRecord[] = [];
  private pending = 0;
  private nextSlot = 0;

  constructor(private readonly directory?: string) {}

  isEnabled(): boolean {
    return process.env.GATEWAY_DEBUG_DIAGNOSTICS === 'true';
  }

  record(scope: string, createDetails: () => unknown): void {
    if (!this.isEnabled() || this.pending >= MAX_PENDING_RECORDS) return;

    this.queue.push({ scope, createDetails });
    if (this.pending++ === 0) {
      setImmediate(() => void this.drain());
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const record = this.queue.shift()!;
      try {
        if (this.isEnabled()) await this.writeRecord(record);
      } catch {
        // Diagnostics are best effort and must never fail a gateway request.
      } finally {
        this.pending--;
      }
    }
  }

  private async writeRecord({ scope, createDetails }: PendingRecord): Promise<void> {
    const contents =
      JSON.stringify({ timestamp: new Date().toISOString(), scope, details: createDetails() }, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ) + '\n';
    if (Buffer.byteLength(contents, 'utf8') > MAX_RECORD_BYTES) return;

    const directory =
      this.directory ?? process.env.GATEWAY_DEBUG_DIAGNOSTICS_DIR ?? join(tmpdir(), 'cardano-ibc-gateway-diagnostics');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryStat = await fs.lstat(directory);
    const uid = process.getuid?.();
    if (
      !directoryStat.isDirectory() ||
      (directoryStat.mode & 0o077) !== 0 ||
      (uid !== undefined && directoryStat.uid !== uid)
    ) {
      return;
    }

    const filename = join(directory, `diagnostic-${this.nextSlot}.json`);
    this.nextSlot = (this.nextSlot + 1) % FILE_COUNT;
    const file = await fs.open(
      filename,
      constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (uid !== undefined && stat.uid !== uid)) return;
      await file.chmod(0o600);
      await file.truncate(0);
      await file.writeFile(contents, 'utf8');
    } finally {
      await file.close();
    }
  }
}

export const gatewayDiagnostics = new GatewayDiagnostics();
