import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GatewayDiagnostics, gatewayDiagnostics } from './gateway-diagnostics';

describe('GatewayDiagnostics', () => {
  let temporaryDirectory: string;
  let directory: string;
  let diagnostics: GatewayDiagnostics;
  const originalEnabled = process.env.GATEWAY_DEBUG_DIAGNOSTICS;
  const originalDirectory = process.env.GATEWAY_DEBUG_DIAGNOSTICS_DIR;

  // Wait for actual filesystem completion before inspecting or removing files.
  async function drain(writer = diagnostics): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (writer['pending'] > 0) {
      if (Date.now() > deadline) throw new Error('Diagnostics did not drain');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async function readRecords(): Promise<Array<{ scope: string; details: unknown }>> {
    return Promise.all(
      (await fs.readdir(directory))
        .sort()
        .map(async (filename) => JSON.parse(await fs.readFile(join(directory, filename), 'utf8'))),
    );
  }

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(join(tmpdir(), 'gateway-diagnostics-test-'));
    directory = join(temporaryDirectory, 'diagnostics');
    diagnostics = new GatewayDiagnostics(directory);
    delete process.env.GATEWAY_DEBUG_DIAGNOSTICS;
    delete process.env.GATEWAY_DEBUG_DIAGNOSTICS_DIR;
  });

  afterEach(async () => {
    await drain();
    await drain(gatewayDiagnostics);
    jest.restoreAllMocks();
    if (originalEnabled === undefined) delete process.env.GATEWAY_DEBUG_DIAGNOSTICS;
    else process.env.GATEWAY_DEBUG_DIAGNOSTICS = originalEnabled;
    if (originalDirectory === undefined) delete process.env.GATEWAY_DEBUG_DIAGNOSTICS_DIR;
    else process.env.GATEWAY_DEBUG_DIAGNOSTICS_DIR = originalDirectory;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it.each([undefined, '', 'false', '1', 'TRUE'])('does no work when the opt-in is %p', async (enabled) => {
    if (enabled !== undefined) process.env.GATEWAY_DEBUG_DIAGNOSTICS = enabled;
    const createDetails = jest.fn();
    const mkdir = jest.spyOn(fs, 'mkdir');
    const open = jest.spyOn(fs, 'open');

    expect(diagnostics.isEnabled()).toBe(false);
    expect(gatewayDiagnostics.isEnabled()).toBe(false);
    diagnostics.record('disabled', createDetails);
    await new Promise((resolve) => setImmediate(resolve));

    expect(createDetails).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('defers detail creation and file IO and writes BigInts as strings', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    process.env.GATEWAY_DEBUG_DIAGNOSTICS_DIR = directory;
    const createDetails = jest.fn(() => ({ packet_sequence: 123n }));
    const mkdir = jest.spyOn(fs, 'mkdir');

    expect(gatewayDiagnostics.isEnabled()).toBe(true);
    expect(gatewayDiagnostics.record('packet', createDetails)).toBeUndefined();
    expect(createDetails).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    await drain(gatewayDiagnostics);

    expect(createDetails).toHaveBeenCalledTimes(1);
    expect(await readRecords()).toEqual([
      expect.objectContaining({ scope: 'packet', details: { packet_sequence: '123' } }),
    ]);
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
    const [filename] = await fs.readdir(directory);
    expect((await fs.stat(join(directory, filename))).mode & 0o777).toBe(0o600);
  });

  it('drops excess work before creating details while a disk write is pending', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    let release: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const originalMkdir = fs.mkdir.bind(fs);
    jest.spyOn(fs, 'mkdir').mockImplementationOnce(async (...args: Parameters<typeof fs.mkdir>) => {
      await held;
      return originalMkdir(...args);
    });
    const accepted = jest.fn(() => ({ accepted: true }));
    const dropped = jest.fn();

    diagnostics.record('first', accepted);
    await new Promise((resolve) => setImmediate(resolve));
    expect(accepted).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 7; index++) diagnostics.record('queued', accepted);
    diagnostics.record('overflow', dropped);
    expect(accepted).toHaveBeenCalledTimes(1);
    release!();
    await drain();

    expect(accepted).toHaveBeenCalledTimes(8);
    expect(dropped).not.toHaveBeenCalled();
    diagnostics.record('after-drain', accepted);
    await drain();
    expect(accepted).toHaveBeenCalledTimes(9);
  });

  it('bounds file count and bytes across ring rotations and restarts', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    for (let round = 0; round < 4; round++) {
      if (round === 2) diagnostics = new GatewayDiagnostics(directory);
      for (let index = 0; index < 8; index++) {
        diagnostics.record(`round-${round}-${index}`, () => 'x'.repeat(round % 2 === 0 ? 65_000 : 1));
      }
      await drain();

      const filenames = await fs.readdir(directory);
      expect(filenames).toHaveLength(8);
      const sizes = await Promise.all(
        filenames.map(async (filename) => (await fs.stat(join(directory, filename))).size),
      );
      expect(sizes.every((size) => size <= 64 * 1024)).toBe(true);
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(8 * 64 * 1024);
      expect((await readRecords()).map(({ scope }) => scope).sort()).toEqual(
        Array.from({ length: 8 }, (_, index) => `round-${round}-${index}`),
      );
    }
  });

  it('drops UTF-8 records that exceed the byte limit including envelope and newline', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    const mkdir = jest.spyOn(fs, 'mkdir');
    diagnostics.record('unicode-too-large', () => '😀'.repeat(17_000));
    diagnostics.record('envelope-too-large', () => 'x'.repeat(64 * 1024));
    await drain();
    expect(mkdir).not.toHaveBeenCalled();

    diagnostics.record('fits', () => '😀'.repeat(16_000));
    await drain();
    expect((await readRecords()).map(({ scope }) => scope)).toEqual(['fits']);
  });

  it('accepts exactly 64 KiB and drops a record one byte larger', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    const envelopeBytes = Buffer.byteLength(
      JSON.stringify({ timestamp: new Date().toISOString(), scope: 'boundary', details: '' }) + '\n',
    );
    diagnostics.record('boundary', () => 'x'.repeat(64 * 1024 - envelopeBytes));
    diagnostics.record('boundary', () => 'x'.repeat(64 * 1024 - envelopeBytes + 1));
    await drain();

    const filenames = await fs.readdir(directory);
    expect(filenames).toHaveLength(1);
    expect((await fs.stat(join(directory, filenames[0]))).size).toBe(64 * 1024);
  });

  it('continues after factories and JSON serialization throw', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    const circular: { self?: unknown } = {};
    circular.self = circular;
    diagnostics.record('throwing-factory', () => {
      throw new Error('cannot construct diagnostics');
    });
    diagnostics.record('circular', () => circular);
    diagnostics.record('throwing-json', () => ({
      toJSON: () => {
        throw new Error('cannot serialize');
      },
    }));
    diagnostics.record('healthy', () => ({ ok: true }));
    await drain();
    expect(await readRecords()).toEqual([expect.objectContaining({ scope: 'healthy', details: { ok: true } })]);
  });

  it('drops disk failures and accepts later records', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    jest.spyOn(fs, 'open').mockRejectedValueOnce(new Error('disk full'));
    expect(() => diagnostics.record('failed-write', () => 'details')).not.toThrow();
    await drain();
    diagnostics.record('recovered', () => 'details');
    await drain();
    expect((await readRecords()).map(({ scope }) => scope)).toEqual(['recovered']);
  });

  it('does not follow an existing directory symlink', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    const target = join(temporaryDirectory, 'target');
    await fs.mkdir(target, { mode: 0o700 });
    await fs.symlink(target, directory);
    diagnostics.record('symlinked-directory', () => 'details');
    await drain();
    expect(await fs.readdir(target)).toEqual([]);
  });

  it.each(['symlink', 'hardlink'])('does not truncate a pre-existing %s slot', async (kind) => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    await fs.mkdir(directory, { mode: 0o700 });
    const target = join(temporaryDirectory, 'keep.txt');
    const slot = join(directory, 'diagnostic-0.json');
    await fs.writeFile(target, 'keep this content');
    if (kind === 'symlink') await fs.symlink(target, slot);
    else await fs.link(target, slot);
    diagnostics.record('unsafe-slot', () => 'details');
    await drain();
    expect(await fs.readFile(target, 'utf8')).toBe('keep this content');
  });
});
