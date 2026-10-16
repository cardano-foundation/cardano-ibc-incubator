package signing

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"sort"

	"github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/mithril/crypto"
)

// StmInitializer prepares one locally trusted test participant.
type StmInitializer struct {
	Stake  Stake
	Params *StmParameters
	Sk     *SigningKey
	Pk     *StmVerificationKey
}

// StmSigner generates signatures under a closed local registration.
type StmSigner struct {
	SignerIndex Index
	Stake       Stake
	Params      *StmParameters
	Sk          *SigningKey
	Vk          *StmVerificationKey
	ClosedReg   *ClosedKeyReg
}

// StmClerk builds aggregate signatures and their membership proofs.
type StmClerk struct {
	ClosedReg *ClosedKeyReg
	Params    *StmParameters
}

// ====================== StmInitializer implementation ======================
// Builds an `StmInitializer` that is ready to register with the key registration service.
// It generates a signing key and its public key for the local registration.
func (si *StmInitializer) Setup(params *StmParameters, stake Stake) (*StmInitializer, error) {
	ikm := make([]byte, 32)
	if _, err := rand.Read(ikm); err != nil {
		return nil, err
	}
	sk, err := Gen(ikm)
	if err != nil {
		return nil, err
	}
	pk, err := sk.VerificationKey()
	if err != nil {
		return nil, err
	}

	si.Stake = stake
	si.Params = params
	si.Sk = sk
	si.Pk = pk

	return si, nil
}

// NewSigner binds this participant to its index in the closed local registration.
func (si *StmInitializer) NewSigner(closedReg *ClosedKeyReg) (*StmSigner, error) {
	var myIndex Index
	found := false
	for i, rp := range closedReg.RegParties {
		if rp.VerificationKey == si.Pk {
			myIndex = Index(i)
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("initializer is not registered")
	}

	return &StmSigner{
		SignerIndex: myIndex,
		Stake:       si.Stake,
		Params:      si.Params,
		Sk:          si.Sk,
		Vk:          si.Pk,
		ClosedReg:   closedReg,
	}, nil
}

// ====================== StmSigner implementation ======================
// This function produces a signature following the description of Section 2.4.
// Once the signature is produced, this function checks whether any index in `[0,..,self.params.m]`
// wins the lottery by evaluating the dense mapping.
// It records all the winning indexes in `Self.indexes`.
// If it wins at least one lottery, it stores the signer's merkle tree index. The proof of membership
// will be handled by the aggregator.
func (s *StmSigner) Sign(msg []byte) (*StmSig, error) {
	if s.ClosedReg == nil {
		return nil, fmt.Errorf("closed registration not found, cannot produce StmSignatures, use core sign")
	}

	msgp := s.ClosedReg.MerkleTree.ToCommitmentBatchCompat().ConcatWithMsg(msg)
	signature, err := s.CoreSign(msgp, s.ClosedReg.TotalStake)
	if err != nil {
		return nil, err
	}

	return signature, nil
}

// CoreSign signs an already prepared message and returns its winning indices.
func (s *StmSigner) CoreSign(msg []byte, totalStake Stake) (*StmSig, error) {
	sigma := s.Sk.Sign(msg)

	indexes, err := s.CheckLottery(msg, sigma, totalStake)
	if err != nil {
		return nil, err
	}
	if len(indexes) > 0 {
		return &StmSig{
			Sigma:       sigma,
			Indexes:     indexes,
			SignerIndex: s.SignerIndex,
		}, nil
	}

	return nil, nil
}

// Collects and returns the winning indices.
func (s *StmSigner) CheckLottery(msg []byte, sigma *Signature, totalStake Stake) ([]Index, error) {
	var indexes []Index
	for index := uint64(0); index < s.Params.M; index++ {
		ev, err := sigma.Eval(msg, Index(index))
		if err != nil {
			return nil, err
		}
		if crypto.EvLtPhi(s.Params.PhiF, ev, s.Stake, totalStake) {
			indexes = append(indexes, Index(index))
		}
	}
	return indexes, nil
}

// ====================== StmClerk implementation ======================
// Create a new `Clerk` from a closed registration instance.
func FromRegistration(params *StmParameters, closedReg *ClosedKeyReg) *StmClerk {
	return &StmClerk{
		Params:    params,
		ClosedReg: closedReg,
	}
}

// Aggregate a set of signatures for their corresponding indices.
//
// This function first deduplicates the repeated signatures, and if there are enough signatures, it collects the merkle tree indexes of unique signatures.
// The list of merkle tree indexes is used to create a batch proof, to prove that all signatures are from eligible signers.
//
// It returns an instance of `StmAggrSig`.
func (clerk *StmClerk) Aggregate(sigs []*StmSig, msg []byte) (*StmAggrSig, error) {
	var sigRegList []StmSigRegParty
	for _, sig := range sigs {
		regParty := clerk.ClosedReg.RegParties[sig.SignerIndex]
		sigRegList = append(sigRegList, StmSigRegParty{
			Sig:      sig,
			RegParty: &regParty,
		})
	}

	avk := clerk.ComputeAVK()
	msgp := avk.MTCommitment.ConcatWithMsg(msg)

	uniqueSigs, err := dedupSigsForIndices(clerk.ClosedReg.TotalStake, clerk.Params, msgp, sigRegList)
	if err != nil {
		return nil, err
	}

	// The batch path covers signers in Merkle index order, as in mithril-stm.
	sort.Slice(uniqueSigs, func(i, j int) bool { return uniqueSigs[i].Sig.SignerIndex < uniqueSigs[j].Sig.SignerIndex })
	var mtIndexList []uint64
	for _, sigReg := range uniqueSigs {
		mtIndexList = append(mtIndexList, uint64(sigReg.Sig.SignerIndex))
	}

	batchProof, err := clerk.ClosedReg.MerkleTree.GetBatchedPath(mtIndexList)
	if err != nil {
		return nil, err
	}

	return &StmAggrSig{
		Signatures: uniqueSigs,
		BatchProof: batchProof,
	}, nil
}

// Compute the `StmAggrVerificationKey` related to the used registration.
func (clerk *StmClerk) ComputeAVK() *StmAggrVerificationKey {
	return &StmAggrVerificationKey{MTCommitment: clerk.ClosedReg.MerkleTree.ToCommitmentBatchCompat(), TotalStake: clerk.ClosedReg.TotalStake}
}

// Resolve duplicate winning indices by choosing the lexicographically smallest
// compressed signature. Certificate verification rejects duplicate indices
// without running this local selection step.
func dedupSigsForIndices(totalStake Stake, params *StmParameters, msg []byte, sigs []StmSigRegParty) ([]StmSigRegParty, error) {
	sigByIndex := make(map[Index]*StmSigRegParty)
	removalIdxByVK := make(map[*StmSigRegParty][]Index)

	for _, sigReg := range sigs {
		if err := verifyCore(sigReg.Sig, params, sigReg.RegParty.VerificationKey, sigReg.RegParty.Stake, msg, totalStake); err != nil {
			continue
		}

		for _, index := range sigReg.Sig.Indexes {
			if existingSig, exists := sigByIndex[index]; exists {
				if bytes.Compare(sigReg.Sig.Sigma.ToBytes(), existingSig.Sig.Sigma.ToBytes()) < 0 {
					removalIdxByVK[existingSig] = append(removalIdxByVK[existingSig], index)
					sigByIndex[index] = &sigReg
				} else {
					removalIdxByVK[&sigReg] = append(removalIdxByVK[&sigReg], index)
				}
			} else {
				sigByIndex[index] = &sigReg
			}
		}
	}

	dedupSigs := make(map[StmSigRegParty]struct{})
	count := uint64(0)

	for _, sigReg := range sigByIndex {
		if _, exists := dedupSigs[*sigReg]; exists {
			continue
		}

		dedupedSig := *sigReg
		if indexes, exists := removalIdxByVK[sigReg]; exists {
			newIndexes := make([]Index, 0, len(dedupedSig.Sig.Indexes))
			for _, index := range dedupedSig.Sig.Indexes {
				keep := true
				for _, remIndex := range indexes {
					if index == remIndex {
						keep = false
						break
					}
				}
				if keep {
					newIndexes = append(newIndexes, index)
				}
			}
			dedupedSig.Sig.Indexes = newIndexes
		}

		dedupSigs[dedupedSig] = struct{}{}
		count += uint64(len(dedupedSig.Sig.Indexes))

		if count >= params.K {
			result := make([]StmSigRegParty, 0, len(dedupSigs))
			for sig := range dedupSigs {
				result = append(result, sig)
			}
			return result, nil
		}
	}

	return nil, fmt.Errorf("not enough signatures: %d < %d", count, params.K)
}

// Verify a core signature by checking that the lottery was won,
// the indexes are in the desired range and the underlying multi signature validates.
func verifyCore(sig *StmSig, params *StmParameters, pk *StmVerificationKey, stake Stake, msg []byte, totalStake Stake) error {
	if err := sig.Sigma.Verify(msg, pk); err != nil {
		return err
	}
	return sig.CheckIndices(params, stake, msg, totalStake)
}
