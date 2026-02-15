export type DenomTraceParts = {
  path: string;
  baseDenom: string;
};

const CHANNEL_ID_SEGMENT_REGEX = /^channel-\d+$/;

/**
 * Split a canonical ICS-20 denom trace into `(path, baseDenom)` without losing slashes in `baseDenom`.
 *
 * Why this parser exists:
 * A denom trace is not "path + one last segment". The base denom may itself contain `/`
 * (for example `gamm/pool/1` or `factory/osmo1.../mytoken`), so "take last segment as base"
 * corrupts data and makes reverse lookup semantics confusing.
 *
 * Parsing rule:
 * - We consume leading `(portId, channelId)` pairs from the front
 * - `channelId` must match `channel-<number>`
 * - Every remaining segment after those pairs belongs to `baseDenom`, including any `/`
 *
 * This mirrors how ICS-20 traces are formed: hop prefixes are prepended as `port/channel`,
 * and the remainder is the original base denomination string.
 */
export function splitFullDenomTrace(fullDenomPath: string): DenomTraceParts {
  const normalized = fullDenomPath.trim();
  if (!normalized) {
    throw new Error('Denom trace cannot be empty');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`Denom trace contains empty path segments: ${fullDenomPath}`);
  }

  let cursor = 0;
  while (cursor + 1 < segments.length) {
    const maybePortId = segments[cursor];
    const maybeChannelId = segments[cursor + 1];

    if (!looksLikePortId(maybePortId) || !CHANNEL_ID_SEGMENT_REGEX.test(maybeChannelId)) {
      break;
    }
    cursor += 2;
  }

  const path = segments.slice(0, cursor).join('/');
  const baseSegments = segments.slice(cursor);
  if (baseSegments.length === 0) {
    throw new Error(`Denom trace is missing base denomination: ${fullDenomPath}`);
  }

  return {
    path,
    baseDenom: baseSegments.join('/'),
  };
}

function looksLikePortId(segment: string): boolean {
  return segment.length > 0;
}
