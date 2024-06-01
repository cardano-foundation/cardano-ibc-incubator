package cryptohelpers

type MKTreeLeafPosition = uint64

type MKTreeNode struct {
	Hash []byte
}

type MKProof struct {
	InnerRoot   *MKTreeNode
	InnerLeaves []*struct {
		MKTreeLeafPosition
		MKTreeNode
	}
	InnerProofSie   uint64
	InnerProofItems []*MKTreeNode
}
