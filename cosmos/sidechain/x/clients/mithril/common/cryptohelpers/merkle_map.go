package cryptohelpers

import "fmt"

type MKMapProof struct {
	MasterProof *MKProof
	SubProofs   []*struct {
		*BlockRange
		*MKMapProof
	}
}

func (proof *MKMapProof) ComputeRoot() *MKTreeNode {
	return proof.MasterProof.InnerRoot
}

func (proof *MKMapProof) Verify() error {
	// Verify each sub-proof
	for _, subProof := range proof.SubProofs {
		err := subProof.MKMapProof.Verify()
		if err != nil {
			return fmt.Errorf("MKMapProof could not verify sub proof: %w", err)
		}
	}

	// Verify the master proof
	err := proof.MasterProof.Verify()
	if err != nil {
		return fmt.Errorf("MKMapProof could not verify master proof: %w", err)
	}

	if len(proof.SubProofs) > 0 {
		var leaves []*MKTreeNode
		for _, subProof := range proof.SubProofs {
			key := subProof.BlockRange.InnerRange.Start // Assuming key is based on the range start
			leaf := &MKTreeNode{
				Hash: append([]byte{byte(key)}, subProof.MKMapProof.ComputeRoot().Hash...),
			}
			leaves = append(leaves, leaf)
		}

		err = proof.MasterProof.Contains(leaves)
		if err != nil {
			return fmt.Errorf("MKMapProof could not match verified leaves of master proof: %w", err)
		}
	}

	return nil
}

func (proof *MKMapProof) Contains(leaf *MKTreeNode) error {
	masterProofContainsLeaf := proof.MasterProof.Contains([]*MKTreeNode{leaf}) == nil
	subProofsContainLeaf := false

	for _, subProof := range proof.SubProofs {
		if subProof.MKMapProof.Contains(leaf) == nil {
			subProofsContainLeaf = true
			break
		}
	}

	if masterProofContainsLeaf || subProofsContainLeaf {
		return nil
	} else {
		return fmt.Errorf("MKMapProof does not contain leaf %x", leaf.Hash)
	}
}
