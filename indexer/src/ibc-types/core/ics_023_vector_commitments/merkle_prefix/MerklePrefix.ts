import {Data} from '../../../plutus/data';

export const MerklePrefixSchema = Data.Object({key_prefix: Data.Bytes()});
export type MerklePrefix = Data.Static<typeof MerklePrefixSchema>;
export const MerklePrefix = MerklePrefixSchema as unknown as MerklePrefix;
