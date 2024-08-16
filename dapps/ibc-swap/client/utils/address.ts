import { fromBech32 } from '@cosmjs/encoding';
import { allChains } from '@/configs/customChainInfo';
import {
  Address,
  BaseAddress,
  ByronAddress,
  RewardAddress,
  EnterpriseAddress,
} from '@emurgo/cardano-serialization-lib-browser';

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

export function shortenUnit(input?: string): string {
  if (!input) return '';

  if (input.length <= 6) {
    return input;
  }

  const start = input.slice(0, 3);
  const end = input.slice(-3);

  return `${start}...${end}`;
}

export function getPublicKeyHashFromAddress(
  addressString: string,
): string | undefined {
  try {
    const address = Address.from_bech32(addressString);
    const baseAddress = BaseAddress.from_address(address);

    if (baseAddress) {
      const publicKeyHash = baseAddress.payment_cred().to_keyhash();
      return publicKeyHash?.to_hex(); // Convert to hexadecimal string
    }

    const byronAddress = ByronAddress.from_address(address);
    if (byronAddress) {
      // Byron addresses do not have a payment key hash
      return undefined;
    }

    const rewardAddress = RewardAddress.from_address(address);
    if (rewardAddress) {
      const publicKeyHash = rewardAddress.payment_cred().to_keyhash();
      return publicKeyHash?.to_hex(); // Convert to hexadecimal string
    }

    return (
      EnterpriseAddress.from_address(address)
        ?.payment_cred()
        ?.to_keyhash()
        ?.to_hex() || undefined
    ); // Address type not recognized
  } catch (error) {
    return undefined;
  }
}
