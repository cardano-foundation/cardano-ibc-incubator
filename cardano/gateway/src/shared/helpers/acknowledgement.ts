import { AcknowledgementResponse } from '../types/channel/acknowledgement_response';
import { convertHex2String, convertString2Hex, hashSHA256, toHex } from './hex';

function extractAcknowledgementValue(response: AcknowledgementResponse): { key: 'result' | 'error'; value: string } {
  if ('AcknowledgementResult' in response) {
    return {
      key: 'result',
      value: convertHex2String(response.AcknowledgementResult.result),
    };
  }

  return {
    key: 'error',
    value: convertHex2String(response.AcknowledgementError.err),
  };
}

export function acknowledgementJsonFromResponse(response: AcknowledgementResponse): string {
  const { key, value } = extractAcknowledgementValue(response);
  return JSON.stringify({ [key]: value });
}

export function acknowledgementBytesFromResponse(response: AcknowledgementResponse): Uint8Array {
  return Buffer.from(acknowledgementJsonFromResponse(response), 'utf8');
}

export function acknowledgementHexFromResponse(response: AcknowledgementResponse): string {
  return toHex(acknowledgementBytesFromResponse(response));
}

export function acknowledgementCommitmentFromResponse(response: AcknowledgementResponse): string {
  return hashSHA256(convertString2Hex(acknowledgementJsonFromResponse(response)));
}
