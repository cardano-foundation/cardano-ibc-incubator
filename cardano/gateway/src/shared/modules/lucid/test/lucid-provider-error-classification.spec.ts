import {
  isNonRetryableRuntimeProviderError,
  isTransientRuntimeProviderError,
} from '../lucid.provider';

describe('Lucid provider runtime error classification', () => {
  it('treats Ogmios script evaluation failures as non-retryable', () => {
    const error = new Error(
      [
        'KupmiosError | ResponseError: StatusCode: non 2xx status code :',
        '{"jsonrpc":"2.0","method":"evaluateTransaction","error":{"code":3010,',
        '"message":"Some scripts of the transactions terminated with error(s).",',
        '"data":[{"validator":{"index":1,"purpose":"spend"},"error":{"code":3012,',
        '"message":"Some of the scripts failed to evaluate to a positive outcome.",',
        '"data":{"validationError":"Caused by: (error)"}}}]}}',
        '(400 POST https://cardano-preprod-v6.ogmios-m1.dmtr.host)',
      ].join(' '),
    );

    expect(isNonRetryableRuntimeProviderError(error)).toBe(true);
    expect(isTransientRuntimeProviderError(error)).toBe(false);
  });

  it('detects script evaluation failures inside wrapped Lucid errors', () => {
    const responseError = new Error(
      [
        'ResponseError: StatusCode: non 2xx status code :',
        '{"jsonrpc":"2.0","method":"evaluateTransaction","error":{"code":3010,',
        '"message":"Some scripts of the transactions terminated with error(s).",',
        '"data":[{"validator":{"index":1,"purpose":"spend"},"error":{"code":3012,',
        '"message":"Some of the scripts failed to evaluate to a positive outcome.",',
        '"data":{"validationError":"Caused by: (error)"}}}]}}',
        '(400 POST https://cardano-preprod-v6.ogmios-m1.dmtr.host)',
      ].join(' '),
    );
    const kupmiosError = new Error('(FiberFailure) KupmiosError');
    const txBuilderError = new Error('{ Complete: (FiberFailure) KupmiosError }');
    Object.defineProperty(kupmiosError, 'cause', { value: responseError });
    Object.defineProperty(txBuilderError, 'cause', { value: kupmiosError });

    expect(isNonRetryableRuntimeProviderError(txBuilderError)).toBe(true);
    expect(isTransientRuntimeProviderError(txBuilderError)).toBe(false);
  });

  it('keeps managed endpoint auth races retryable', () => {
    const error = new Error(
      'KupmiosError | ResponseError: StatusCode: non 2xx status code : Unauthorized (401 POST https://cardano-preprod-v6.ogmios-m1.dmtr.host)',
    );

    expect(isNonRetryableRuntimeProviderError(error)).toBe(false);
    expect(isTransientRuntimeProviderError(error)).toBe(true);
  });
});
