import { Registry } from '@cosmjs/proto-signing';
import {
  AminoTypes,
  createDefaultAminoConverters,
  defaultRegistryTypes,
} from '@cosmjs/stargate';

export const registry = new Registry(defaultRegistryTypes);
export const aminoTypes = new AminoTypes(createDefaultAminoConverters());
