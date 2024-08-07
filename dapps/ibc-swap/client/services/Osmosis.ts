import { sha256 } from 'js-sha256';
import { DenomTrace } from 'cosmjs-types/ibc/applications/transfer/v1/transfer';

import { allDenomTracesUrl } from '@/constants';
import { IBCDenomTrace } from '@/types/IBCParams';

async function fetchOsmosisDenomTraces(): Promise<IBCDenomTrace> {
    const fetchUrl = `${process.env.NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT}/${allDenomTracesUrl}?pagination.limit=10000`;
//   const fetchUrl = `https://lcd.osmosis.zone/${allDenomTracesUrl}?pagination.limit=10000`;
  let tmpTrace: IBCDenomTrace = {};
  const firstFetch = await fetch(fetchUrl).then((res) => res.json());
  const denomTraces = (firstFetch?.denom_traces || []) as DenomTrace[];
  denomTraces.forEach((tracing) => {
    const { path, baseDenom } = tracing;
    const ibcHash = `ibc/${sha256(`${path}/${baseDenom}`).toUpperCase()}`;
    tmpTrace[`${ibcHash}`] = {
      path,
      baseDenom,
    };
  });
  let nextKey = firstFetch?.pagination?.next_key;
  while (nextKey && typeof nextKey === 'string') {
    const nextFetchUrl = `${fetchUrl}&pagination.key=${nextKey}`;
    const nextFetch = await fetch(nextFetchUrl).then((res) => res.json());
    const denomTraces = (nextFetch?.denom_traces || []) as DenomTrace[];
    denomTraces.forEach((tracing) => {
      const { path, baseDenom } = tracing;
      const ibcHash = `ibc/${sha256(`${path}/${baseDenom}`).toUpperCase()}`;
      tmpTrace[`${ibcHash}`] = {
        path,
        baseDenom,
      };
    });
    nextKey = nextFetch?.pagination?.next_key;
  }
  return tmpTrace;
}

export default {
  fetchOsmosisDenomTraces,
};
