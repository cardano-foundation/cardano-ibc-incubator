import { DEFAULT_PFM_FEE, queryPacketForwardParamsUrl } from '@/constants';
import BigNumber from 'bignumber.js';

export async function fetchPacketForwardFee(
  restUrl: string,
): Promise<BigNumber> {
  const fetchUrl = `${restUrl}${queryPacketForwardParamsUrl}`;
  const defaultFee = BigNumber(DEFAULT_PFM_FEE);

  try {
    const res = await fetch(fetchUrl);

    if (!res.ok) {
      return defaultFee;
    }

    const data = await res.json();
    const feePercentage = data?.params?.fee_percentage;

    if (
      typeof feePercentage !== 'string' &&
      typeof feePercentage !== 'number'
    ) {
      return defaultFee;
    }

    return BigNumber(feePercentage);
  } catch {
    return defaultFee;
  }
}
