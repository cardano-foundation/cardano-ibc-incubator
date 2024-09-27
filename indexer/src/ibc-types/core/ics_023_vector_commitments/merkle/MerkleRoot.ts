import {Data} from '../../../plutus/data';

export const MerkleRootSchema = Data.Object({hash: Data.Bytes()});
export type MerkleRoot = Data.Static<typeof MerkleRootSchema>;
export const MerkleRoot = MerkleRootSchema as unknown as MerkleRoot;
