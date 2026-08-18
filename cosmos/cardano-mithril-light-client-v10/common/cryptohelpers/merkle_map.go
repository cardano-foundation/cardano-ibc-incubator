package cryptohelpers

import (
	"encoding/json"
	"fmt"
)

type SubProof struct {
	*BlockRange
	*MKMapProof
}

type MKMapProof struct {
	MasterProof *MKProof    `json:"master_proof"`
	SubProofs   []*SubProof `json:"sub_proofs,omitempty"`
}

func (p *SubProof) UnmarshalJSON(data []byte) error {
	if len(data) == 0 {
		return nil
	}

	var response []interface{}
	err := json.Unmarshal(data, &response)
	if err != nil {
		return err
	}

	blockRangeMap, ok := response[0].(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid sub proof format: invalid block range format")
	}
	blockRangeData, err := json.Marshal(blockRangeMap)
	if err != nil {
		return err
	}
	blockRange := &BlockRange{}
	if err := json.Unmarshal(blockRangeData, blockRange); err != nil {
		return err
	}

	mkMapProofMap, ok := response[1].(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid sub proof format: invalid merkle map proof format")
	}
	mkMapProofData, err := json.Marshal(mkMapProofMap)
	if err != nil {
		return err
	}
	mkMapProof := &MKMapProof{}
	if err := json.Unmarshal(mkMapProofData, mkMapProof); err != nil {
		return err
	}

	p.BlockRange = blockRange
	p.MKMapProof = mkMapProof

	return nil
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
			leaf := subProof.BlockRange.ToMKTreeNode().Add(subProof.ComputeRoot())
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
