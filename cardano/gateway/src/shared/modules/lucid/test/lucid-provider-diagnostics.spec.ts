import { ConfigService } from '@nestjs/config';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gatewayDiagnostics } from '../../../helpers/gateway-diagnostics';
import { LucidClient } from '../lucid.provider';

type EvaluationProvider = {
  evaluateTx: (tx: string, additionalUTxOs?: unknown[]) => Promise<unknown>;
};

describe('Lucid provider evaluation diagnostics', () => {
  let temporaryDirectory: string;
  let directory: string;
  const originalEnabled = process.env.GATEWAY_DEBUG_DIAGNOSTICS;
  const originalDirectory = process.env.GATEWAY_DEBUG_DIAGNOSTICS_DIR;

  async function drainDiagnostics(): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (gatewayDiagnostics['pending'] > 0) {
      if (Date.now() > deadline) throw new Error('Diagnostics did not drain');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async function createProvider(evaluateTx: EvaluationProvider['evaluateTx']): Promise<EvaluationProvider> {
    const provider = { evaluateTx };
    // The factory imports Lucid through eval so keep that boundary local to this call.
    jest.spyOn(globalThis, 'eval').mockReturnValueOnce(
      Promise.resolve({
        Kupmios: jest.fn(() => provider),
        Lucid: jest.fn(async () => provider),
      }),
    );
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            utxoCostPerByte: 4310,
            plutusCostModels: { 'plutus:v1': [1], 'plutus:v2': [2] },
            scriptExecutionPrices: { memory: '1/100', cpu: '1/1000' },
          },
        }),
      ),
    );

    await LucidClient.useFactory(
      new ConfigService({
        cardanoNetwork: 'Preprod',
        kupoEndpoint: 'http://localhost:1442',
        ogmiosEndpoint: 'http://localhost:1337',
        kupoApiKey: '',
        ogmiosApiKey: '',
      }),
    );
    return provider;
  }

  beforeEach(async () => {
    temporaryDirectory = await fs.promises.mkdtemp(join(tmpdir(), 'lucid-provider-diagnostics-test-'));
    directory = join(temporaryDirectory, 'diagnostics');
    delete process.env.GATEWAY_DEBUG_DIAGNOSTICS;
    process.env.GATEWAY_DEBUG_DIAGNOSTICS_DIR = directory;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await drainDiagnostics();
    jest.restoreAllMocks();
    if (originalEnabled === undefined) delete process.env.GATEWAY_DEBUG_DIAGNOSTICS;
    else process.env.GATEWAY_DEBUG_DIAGNOSTICS = originalEnabled;
    if (originalDirectory === undefined) delete process.env.GATEWAY_DEBUG_DIAGNOSTICS_DIR;
    else process.env.GATEWAY_DEBUG_DIAGNOSTICS_DIR = originalDirectory;
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('passes successful evaluation results through without recording diagnostics', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    const result = [{ redeemer_tag: 'spend', redeemer_index: 0, ex_units: { mem: 100, steps: 200 } }];
    const evaluateTx = jest.fn().mockResolvedValue(result);
    const provider = await createProvider(evaluateTx);
    const record = jest.spyOn(gatewayDiagnostics, 'record');
    const additionalUTxOs = [{ txHash: 'abc', outputIndex: 0 }];

    await expect(provider.evaluateTx('a100', additionalUTxOs)).resolves.toBe(result);

    expect(evaluateTx).toHaveBeenCalledTimes(1);
    expect(evaluateTx).toHaveBeenCalledWith('a100', additionalUTxOs);
    expect(evaluateTx.mock.contexts[0]).toBe(provider);
    expect(record).not.toHaveBeenCalled();
    expect(await fs.promises.readdir(temporaryDirectory)).toEqual([]);
  });

  it('preserves the original rejection without serializing or writing diagnostics by default', async () => {
    const error = new Error('unsupported evaluation response');
    const evaluateTx = jest.fn().mockRejectedValue(error);
    const provider = await createProvider(evaluateTx);
    const toJSON = jest.fn(() => {
      throw new Error('must not serialize diagnostics');
    });
    const additionalUTxOs = [{ txHash: 'abc', outputIndex: 0, toJSON }];
    const writeFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const mkdir = jest.spyOn(fs.promises, 'mkdir');
    const open = jest.spyOn(fs.promises, 'open');

    await expect(provider.evaluateTx('a100', additionalUTxOs)).rejects.toBe(error);
    await new Promise((resolve) => setImmediate(resolve));

    expect(evaluateTx).toHaveBeenCalledTimes(1);
    expect(evaluateTx).toHaveBeenCalledWith('a100', additionalUTxOs);
    expect(evaluateTx.mock.contexts[0]).toBe(provider);
    expect(toJSON).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(await fs.promises.readdir(temporaryDirectory)).toEqual([]);
  });

  it('records an opted-in evaluation failure with its transaction and additional UTxOs', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    const error = new Error('unsupported evaluation response');
    const evaluateTx = jest.fn().mockRejectedValue(error);
    const provider = await createProvider(evaluateTx);
    const additionalUTxOs = [{ txHash: 'abc', outputIndex: 0, assets: { lovelace: 2_000_000n } }];

    await expect(provider.evaluateTx('a100', additionalUTxOs)).rejects.toBe(error);
    await drainDiagnostics();

    const filenames = await fs.promises.readdir(directory);
    expect(filenames).toHaveLength(1);
    expect(JSON.parse(await fs.promises.readFile(join(directory, filenames[0]), 'utf8'))).toEqual(
      expect.objectContaining({
        scope: 'evaluateTx-failure',
        details: {
          txCbor: 'a100',
          additionalUTxOs: [{ txHash: 'abc', outputIndex: 0, assets: { lovelace: '2000000' } }],
          error: { name: error.name, message: error.message, stack: error.stack },
        },
      }),
    );
  });

  it('keeps the existing rejection message for errors classified as non-retryable', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    const evaluateTx = jest.fn().mockRejectedValue(new Error('validator returned false'));
    const provider = await createProvider(evaluateTx);

    const rejection = await provider.evaluateTx('a100').catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toContain('non-retryable Cardano provider rejection');
    expect((rejection as Error).message).toContain('Not retrying.');
    expect(evaluateTx).toHaveBeenCalledTimes(1);
    await drainDiagnostics();

    const [filename] = await fs.promises.readdir(directory);
    expect(JSON.parse(await fs.promises.readFile(join(directory, filename), 'utf8')).details.error).toEqual({
      name: (rejection as Error).name,
      message: (rejection as Error).message,
      stack: (rejection as Error).stack,
    });
  });

  it('preserves non-Error rejections and records missing additional UTxOs as an empty array', async () => {
    process.env.GATEWAY_DEBUG_DIAGNOSTICS = 'true';
    const error = 'unsupported evaluation response';
    const evaluateTx = jest.fn().mockRejectedValue(error);
    const provider = await createProvider(evaluateTx);

    await expect(provider.evaluateTx('a100')).rejects.toBe(error);
    await drainDiagnostics();

    expect(evaluateTx).toHaveBeenCalledWith('a100', undefined);
    const [filename] = await fs.promises.readdir(directory);
    expect(JSON.parse(await fs.promises.readFile(join(directory, filename), 'utf8')).details).toEqual({
      txCbor: 'a100',
      additionalUTxOs: [],
      error,
    });
  });
});
