import { IBCDenomTrace } from '@/types/IBCParams';
import { fetchAllDenomTraces } from './CommonCosmosServices';

export async function fetchOsmosisDenomTraces(): Promise<IBCDenomTrace> {
  const restUrl =
    process.env.NEXT_PUBLIC_LOCALOSMOIS_REST_ENDPOINT ||
    'https://lcd.osmosis.zone';
  return fetchAllDenomTraces(restUrl);
}
