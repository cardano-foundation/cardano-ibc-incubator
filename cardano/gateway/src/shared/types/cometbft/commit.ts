export type PartSetHeader = { total: bigint; hash: string };
export type BlockID = { hash: string; partSetHeader: PartSetHeader };
export type Commit = { height: bigint; blockId: BlockID; signatures: CommitSig[] };
export type CommitSig = { block_id_flag: bigint; validator_address: string; timestamp: bigint; signature: string };
