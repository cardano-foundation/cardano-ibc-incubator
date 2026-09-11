# IBC state commitment fixtures

`nextSequenceRecv/ports/{port}/channels/{channel}` commits a CBOR unsigned integer. For sequence `1` the Cardano leaf value is `01`. ibc-go expects the same number as eight big-endian bytes, `0000000000000001`. Light clients compare the decoded numbers and use the original CBOR bytes when verifying the root.

`next-sequence-recv.json` pins this encoding from zero through `uint64` maximum, including a value above JavaScript's safe integer range. Its `version` identifies the fixture format. The roots and proof path come from the Gateway's shared tree implementation. TypeScript tests rebuild and update that tree, and Go tests verify the same proofs in each Cardano light client.
