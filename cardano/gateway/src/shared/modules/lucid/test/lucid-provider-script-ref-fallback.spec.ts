import { evaluateTxWithOgmiosScriptRefFallback } from '../lucid.provider';

const plutusScriptDecodeError = () =>
  new Error(
    'ResponseError: StatusCode: non 2xx status code : ' +
      '{"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid request: couldn\'t decode plutus script."}}',
  );

describe('Ogmios script-reference evaluation fallback', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries without explicitly supplied script-reference UTxOs when Ogmios cannot decode one', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const scriptRefUtxo = {
      txHash: 'script-ref-tx',
      outputIndex: 0,
      scriptRef: { type: 'PlutusV3', script: '00' },
    };
    const evaluateTx = jest.fn().mockRejectedValueOnce(plutusScriptDecodeError()).mockResolvedValueOnce('evaluated');

    await expect(evaluateTxWithOgmiosScriptRefFallback(evaluateTx, [scriptRefUtxo])).resolves.toBe('evaluated');
    expect(evaluateTx).toHaveBeenNthCalledWith(1, [scriptRefUtxo]);
    expect(evaluateTx).toHaveBeenNthCalledWith(2, []);
  });

  it('retains every non-script additional UTxO in the fallback evaluation', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const walletUtxo = { txHash: 'wallet-tx', outputIndex: 1 };
    const datumUtxo = { txHash: 'datum-tx', outputIndex: 2, datum: 'd87980' };
    const scriptRefUtxo = {
      txHash: 'script-ref-tx',
      outputIndex: 0,
      scriptRef: { type: 'PlutusV3', script: '00' },
    };
    const evaluateTx = jest.fn().mockRejectedValueOnce(plutusScriptDecodeError()).mockResolvedValueOnce('evaluated');

    await evaluateTxWithOgmiosScriptRefFallback(evaluateTx, [walletUtxo, scriptRefUtxo, datumUtxo]);

    expect(evaluateTx).toHaveBeenNthCalledWith(2, [walletUtxo, datumUtxo]);
  });

  it('does not retry unrelated provider failures', async () => {
    const unrelatedError = new Error('Invalid request: could not decode transaction.');
    const evaluateTx = jest.fn().mockRejectedValue(unrelatedError);
    const scriptRefUtxo = {
      txHash: 'script-ref-tx',
      outputIndex: 0,
      scriptRef: { type: 'PlutusV3', script: '00' },
    };

    await expect(evaluateTxWithOgmiosScriptRefFallback(evaluateTx, [scriptRefUtxo])).rejects.toBe(unrelatedError);
    expect(evaluateTx).toHaveBeenCalledTimes(1);
  });

  it('does not retry the script decode failure when no script-reference UTxO was supplied', async () => {
    const decodeError = plutusScriptDecodeError();
    const evaluateTx = jest.fn().mockRejectedValue(decodeError);

    await expect(
      evaluateTxWithOgmiosScriptRefFallback(evaluateTx, [{ txHash: 'wallet-tx', outputIndex: 1 }]),
    ).rejects.toBe(decodeError);
    expect(evaluateTx).toHaveBeenCalledTimes(1);
  });

  it('propagates the fallback evaluation failure', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fallbackError = new Error('The referenced output is not available in the ledger.');
    const evaluateTx = jest.fn().mockRejectedValueOnce(plutusScriptDecodeError()).mockRejectedValueOnce(fallbackError);
    const scriptRefUtxo = {
      txHash: 'script-ref-tx',
      outputIndex: 0,
      scriptRef: { type: 'PlutusV3', script: '00' },
    };

    await expect(evaluateTxWithOgmiosScriptRefFallback(evaluateTx, [scriptRefUtxo])).rejects.toBe(fallbackError);
    expect(evaluateTx).toHaveBeenCalledTimes(2);
  });
});
