export type ProofSpec = {
  leaf_spec: {
    hash: bigint;
    prehash_key: bigint;
    prehash_value: bigint;
    length: bigint;
    prefix: string;
  };
  inner_spec: {
    child_order: bigint[];
    child_size: bigint;
    min_prefix_length: bigint;
    max_prefix_length: bigint;
    empty_child: string;
    hash: bigint;
  };
  max_depth: bigint;
  min_depth: bigint;
  prehash_key_before_comparison: boolean;
};
