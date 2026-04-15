import { AcknowledgementResponse } from '../types/channel/acknowledgement_response';
import { convertHex2String, convertString2Hex, hashSHA256, toHex } from './hex';

function extractAcknowledgementValue(response: AcknowledgementResponse): { key: 'result' | 'error'; value: string } {
  if ('AcknowledgementResult' in response) {
    return {
      key: 'result',
      // Gateway acks store result bytes as hex strings, but the committed IBC ack
      // JSON itself contains the plain UTF-8 payload.
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
  // Channel state commits the canonical JSON acknowledgement bytes, not the
  // gateway's internal hex wrapper representation.
  return hashSHA256(convertString2Hex(acknowledgementJsonFromResponse(response)));
}
