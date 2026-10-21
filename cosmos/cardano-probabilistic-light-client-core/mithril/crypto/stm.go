package crypto

import (
	"fmt"
)

// Stake represents the quantity of stake held by a party, represented as a uint64.
type Stake uint64

// Index represents the quorum index for signatures.
// An aggregate signature (StmMultiSig) must have at least k unique indices.
type Index uint64

// Wrapper of the MultiSignature Verification key
type StmVerificationKey = VerificationKey

// Protocol parameters authenticated by the certificate verifier.
type StmParameters struct {
	// Security parameter, upper bound on indices.
	M uint64
	// Quorum parameter.
	K uint64
	// `f` in phi(w) = 1 - (1 - f)^w, where w is the stake of a participant..
	PhiF float64
}

// Signature created by a single party who has won the lottery.
type StmSig struct {
	Sigma       *Signature `json:"sigma,omitempty"`
	Indexes     []Index    `json:"indexes,omitempty"`
	SignerIndex Index      `json:"signer_index,omitempty"`
}

// Stm aggregate key (batch compatible), which contains the merkle tree commitment and the total stake of the system.
// Batch Compat Merkle tree commitment includes the number of leaves in the tree in order to obtain batch path.
type StmAggrVerificationKey struct {
	MTCommitment *MerkleTreeCommitmentBatchCompat `json:"mt_commitment,omitempty"`
	TotalStake   Stake                            `json:"total_stake,omitempty"`
}

// Signature with its registered party.
type StmSigRegParty struct {
	// Stm signature
	Sig *StmSig `json:"sig,omitempty"`
	// Registered party
	RegParty *RegParty `json:"reg_party,omitempty"`
}

type StmAggrSig struct {
	Signatures []StmSigRegParty `json:"signatures,omitempty"`
	BatchProof *BatchPath       `json:"batch_proof,omitempty"`
}

// Verify that all indices of a signature are valid.
func (sig *StmSig) CheckIndices(params *StmParameters, stake Stake, msg []byte, totalStake Stake) error {
	for _, index := range sig.Indexes {
		if uint64(index) > params.M {
			return fmt.Errorf("index out of bound")
		}
		ev, err := sig.Sigma.Eval(msg, index)
		if err != nil {
			return err
		}
		if !EvLtPhi(params.PhiF, ev, stake, totalStake) {
			return fmt.Errorf("lottery check failed for index %d", index)
		}
	}
	return nil
}

// ====================== StmAggrSig implementation ======================
// Verify all checks from signatures, except for the signature verification itself.
//
// Indices and quorum are checked by `CoreVerifier::preliminary_verify` with `msgp`.
// It collects leaves from signatures and checks the batch proof.
// After batch proof is checked, it collects and returns the signatures and
// verification keys to be used by aggregate verification.
func (sa *StmAggrSig) PreliminaryVerify(msg []byte, avk *StmAggrVerificationKey, parameters *StmParameters) ([]*Signature, []*VerificationKey, error) {
	msgp := avk.MTCommitment.ConcatWithMsg(msg)
	if err := new(CoreVerifier).PreliminaryVerify(avk.TotalStake, sa.Signatures, parameters, msgp); err != nil {
		return nil, nil, err
	}

	var leaves []RegParty
	for _, sigReg := range sa.Signatures {
		leaves = append(leaves, *sigReg.RegParty)
	}

	if err := avk.MTCommitment.Check(leaves, sa.BatchProof); err != nil {
		return nil, nil, err
	}

	return new(CoreVerifier).CollectSigsVks(sa.Signatures)
}

// Verify aggregate signature, by checking that
// * each signature contains only valid indices,
// * the lottery is indeed won by each one of them,
// * the merkle tree path is valid,
// * the aggregate signature validates with respect to the aggregate verification key
// (aggregation is computed using functions `MSP.BKey` and `MSP.BSig` as described in Section 2.4 of the paper).
func (sa *StmAggrSig) Verify(msg []byte, avk *StmAggrVerificationKey, parameters *StmParameters) error {
	msgp := avk.MTCommitment.ConcatWithMsg(msg)
	sigs, vks, err := sa.PreliminaryVerify(msg, avk, parameters)
	if err != nil {
		return err
	}

	if err := new(Signature).VerifyAggregate(msgp, vks, sigs); err != nil {
		return err
	}
	return nil
}

// Preliminary verification that checks whether indices are unique and the quorum is achieved.
func (cv *CoreVerifier) PreliminaryVerify(totalStake Stake, signatures []StmSigRegParty, parameters *StmParameters, msg []byte) error {
	// Bounds and uniqueness are checked before any lottery evaluation, which
	// is costly. Otherwise each copy of a repeated winning index would cost an
	// evaluation, and a certificate could repeat one index hundreds of
	// thousands of times. This way at most M+1 indices reach the lottery. The
	// accepted signatures are the same as mithril-stm's.
	uniqueIndices := make(map[Index]struct{})
	for _, sigReg := range signatures {
		for _, index := range sigReg.Sig.Indexes {
			if uint64(index) > parameters.M {
				return fmt.Errorf("index out of bound")
			}
			if _, repeated := uniqueIndices[index]; repeated {
				return fmt.Errorf("indices are not unique")
			}
			uniqueIndices[index] = struct{}{}
		}
	}
	if uint64(len(uniqueIndices)) < parameters.K {
		return fmt.Errorf("no quorum: %d < %d", len(uniqueIndices), parameters.K)
	}

	for _, sigReg := range signatures {
		if err := sigReg.Sig.CheckIndices(parameters, sigReg.RegParty.Stake, msg, totalStake); err != nil {
			return err
		}
	}
	return nil
}

// Collect and return `Vec<Signature>, Vec<VerificationKey>` which will be used
// by the aggregate verification.
func (cv *CoreVerifier) CollectSigsVks(sigRegList []StmSigRegParty) ([]*Signature, []*VerificationKey, error) {
	sigs := make([]*Signature, len(sigRegList))
	vks := make([]*VerificationKey, len(sigRegList))

	for i, sigReg := range sigRegList {
		sigs[i] = sigReg.Sig.Sigma
		vks[i] = sigReg.RegParty.VerificationKey
	}

	return sigs, vks, nil
}

// CoreVerifier checks quorum and collects the keys and signatures for BLS verification.
type CoreVerifier struct{}
