import {Data} from '../../../plutus/data';

export const MerklePathSchema = Data.Object({
  key_path: Data.Array(Data.Bytes()),
});
export type MerklePath = Data.Static<typeof MerklePathSchema>;
export const MerklePath = MerklePathSchema as unknown as MerklePath;
