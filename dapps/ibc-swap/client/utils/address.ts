import { fromBech32 } from '@cosmjs/encoding';
import { allChains } from '@/configs/customChainInfo';

export function verifyAddress(address: string, chainId?: string): boolean {
  if (!chainId || !address?.length) {
    return false;
  }
  const chainFound = allChains.find((chain) => chain.chain_id === chainId);

  if (!chainFound) {
    return false;
  }

  const bech32Prefix = chainFound.bech32_prefix;
  try {
    const addrBech32 = fromBech32(address);
    return addrBech32?.prefix === bech32Prefix;
  } catch (_) {
    // console.log(e);
    return false;
  }
}
