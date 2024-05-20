package crypto

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
)

// Stake represents the quantity of stake held by a party, represented as a uint64.
type Stake uint64

// Index represents the quorum index for signatures.
// An aggregate signature (StmMultiSig) must have at least k unique indices.
type Index uint64

// Wrapper of the MultiSignature Verification key with proof of possession
type StmVerificationKeyPoP = VerificationKeyPoP

// Wrapper of the MultiSignature Verification key
type StmVerificationKey = VerificationKey

// Used to set protocol parameters.
// todo: this is the criteria to consider parameters valid:
// Let A = max assumed adversarial stake
// Let a = A / max_stake
// Let p = φ(a)  // f needs tuning, something close to 0.2 is reasonable
// Then, we're secure if SUM[from i=k to i=m] Binomial(i successes, m experiments, p chance of success) <= 2^-100 or thereabouts.
// The latter turns to 1 - BinomialCDF(k-1,m,p)
type StmParameters struct {
	// Security parameter, upper bound on indices.
	M uint64
	// Quorum parameter.
	K uint64
	// `f` in phi(w) = 1 - (1 - f)^w, where w is the stake of a participant..
	PhiF float64
}

// Initializer for `StmSigner`.
// This is the data that is used during the key registration procedure.
// Once the latter is finished, this instance is consumed into an `StmSigner`.
type StmInitializer struct {
	// This participant's stake.
	Stake Stake
	// Current protocol instantiation parameters.
	Params *StmParameters
	// Secret key.
	Sk *SigningKey
	// Verification (public) key + proof of possession.
	Pk *StmVerificationKeyPoP
}

// Participant in the protocol can sign messages.
// * If the signer has `closed_reg`, then it can generate Stm certificate.
//   - This kind of signer can only be generated out of an `StmInitializer` and a `ClosedKeyReg`.
//   - This ensures that a `MerkleTree` root is not computed before all participants have registered.
//
// * If the signer does not have `closed_reg`, then it is a core signer.
//   - This kind of signer cannot participate certificate generation.
//   - Signature generated can be verified by a full node verifier (core verifier).
type StmSigner struct {
	SignerIndex Index
	Stake       Stake
	Params      *StmParameters
	Sk          *SigningKey
	Vk          *StmVerificationKey
	ClosedReg   *ClosedKeyReg
}

// `StmClerk` can verify and aggregate `StmSig`s and verify `StmMultiSig`s.
// Clerks can only be generated with the registration closed.
// This avoids that a Merkle Tree is computed before all parties have registered.
type StmClerk struct {
	ClosedReg *ClosedKeyReg
	Params    *StmParameters
}

// Signature created by a single party who has won the lottery.
type StmSig struct {
	Sigma       *Signature
	Indexes     []Index
	SignerIndex Index
}

// Stm aggregate key (batch compatible), which contains the merkle tree commitment and the total stake of the system.
// Batch Compat Merkle tree commitment includes the number of leaves in the tree in order to obtain batch path.
type StmAggrVerificationKey struct {
	MTCommitment *MerkleTreeCommitmentBatchCompat
	TotalStake   Stake
}

// Signature with its registered party.
type StmSigRegParty struct {
	// Stm signature
	Sig *StmSig
	// Registered party
	RegParty *RegParty
}

// ====================== StmSigRegParty implementation ======================
func (srp *StmSigRegParty) Serialize() (string, error) {
	b, err := json.Marshal(srp)
	if err != nil {
		return "", fmt.Errorf("error serializing StmSigRegParty: %v", err)
	}
	return string(b), nil
}

type StmAggrSig struct {
	Signatures []StmSigRegParty
	BatchProof *BatchPath
}

type CoreVerifier struct {
	EligibleParties []RegParty
	TotalStake      Stake
}

// ====================== StmParameters implementation ======================
// Convert to bytes
// # Layout
// * Security parameter, `m` (as u64)
// * Quorum parameter, `k` (as u64)
// * Phi f, as (f64)
func (p *StmParameters) ToBytes() ([]byte, error) {
	buf := new(bytes.Buffer)
	err := binary.Write(buf, binary.BigEndian, p.M)
	if err != nil {
		return nil, err
	}
	err = binary.Write(buf, binary.BigEndian, p.K)
	if err != nil {
		return nil, err
	}
	err = binary.Write(buf, binary.BigEndian, p.PhiF)
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Extract the `StmParameters` from a byte slice.
// # Error
// The function fails if the given string of bytes is not of required size.
func (p *StmParameters) FromBytes(data []byte) (*StmParameters, error) {
	if len(data) != 24 {
		return nil, fmt.Errorf("incorrect byte slice length")
	}

	reader := bytes.NewReader(data)
	var m, k uint64
	var phiF float64

	err := binary.Read(reader, binary.BigEndian, &m)
	if err != nil {
		return nil, err
	}
	err = binary.Read(reader, binary.BigEndian, &k)
	if err != nil {
		return nil, err
	}
	err = binary.Read(reader, binary.BigEndian, &phiF)
	if err != nil {
		return nil, err
	}

	p.M = m
	p.K = k
	p.PhiF = phiF

	return p, nil
}

// ====================== StmInitializer implementation ======================
// Builds an `StmInitializer` that is ready to register with the key registration service.
// This function generates the signing and verification key with a PoP, and initialises the structure.
func (si *StmInitializer) Setup(params *StmParameters, stake Stake) (*StmInitializer, error) {
	sk, err := Gen()
	if err != nil {
		return nil, err
	}
	pk, err := new(StmVerificationKeyPoP).FromSigningKey(sk)
	if err != nil {
		return nil, err
	}

	si.Stake = stake
	si.Params = params
	si.Sk = sk
	si.Pk = pk

	return si, nil
}

// Build the `avk` for the given list of parties.
//
// Note that if this StmInitializer was modified *between* the last call to `register`,
// then the resulting `StmSigner` may not be able to produce valid signatures.
//
// Returns an `StmSigner` specialized to
// * this `StmSigner`'s ID and current stake
// * this `StmSigner`'s parameter valuation
// * the `avk` as built from the current registered parties (according to the registration service)
// * the current total stake (according to the registration service)
// # Error
// This function fails if the initializer is not registered.
// NewSigner creates a new StmSigner from StmInitializer.
func (si *StmInitializer) NewSigner(closedReg *ClosedKeyReg) (*StmSigner, error) {
	var myIndex Index
	found := false
	for i, rp := range closedReg.RegParties {
		if rp.VerificationKey == si.Pk.VK {
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
		Vk:          si.Pk.VK,
		ClosedReg:   closedReg,
	}, nil
}

// Creates a new core signer that does not include closed registration.
// Takes `eligible_parties` as a parameter and determines the signer's index in the parties.
// `eligible_parties` is verified and trusted which is only run by a full-node
func (si *StmInitializer) NewCoreSigner(eligibleParties []RegParty) *StmSigner {
	for i, rp := range eligibleParties {
		if rp.VerificationKey == si.Pk.VK {
			return &StmSigner{
				SignerIndex: Index(i),
				Stake:       si.Stake,
				Params:      si.Params,
				Sk:          si.Sk,
				Vk:          si.Pk.VK,
				ClosedReg:   nil,
			}
		}
	}
	return nil
}

// Convert to bytes
// # Layout
// * Stake (u64)
// * Params
// * Secret Key
// * Public key (including PoP)
func (si *StmInitializer) ToBytes() ([]byte, error) {
	buffer := new(bytes.Buffer)
	// Write Stake as u64
	if err := binary.Write(buffer, binary.BigEndian, si.Stake); err != nil {
		return nil, err
	}
	// Write Params
	paramsBytes, err := si.Params.ToBytes()
	if err != nil {
		return nil, err
	}
	if _, err := buffer.Write(paramsBytes); err != nil {
		return nil, err
	}
	// Write Secret Key
	skBytes := si.Sk.ToBytes()
	if _, err := buffer.Write(skBytes); err != nil {
		return nil, err
	}
	// Write Public Key with Proof of Possession
	pkBytes := si.Pk.ToBytes()
	if _, err := buffer.Write(pkBytes); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// Convert a slice of bytes to an `StmInitializer`
// # Error
// The function fails if the given string of bytes is not of required size.
func (si *StmInitializer) FromBytes(data []byte) (*StmInitializer, error) {
	if len(data) != 256 {
		return nil, fmt.Errorf("incorrect byte slice length")
	}
	reader := bytes.NewReader(data)

	var stake Stake
	if err := binary.Read(reader, binary.BigEndian, &stake); err != nil {
		return nil, err
	}

	paramsBytes := make([]byte, 24) // Assuming the size of Params bytes is 24
	if _, err := reader.Read(paramsBytes); err != nil {
		return nil, err
	}
	params, err := new(StmParameters).FromBytes(paramsBytes)
	if err != nil {
		return nil, err
	}

	skBytes := make([]byte, 32) // Assuming the size of SigningKey bytes is 32
	if _, err := reader.Read(skBytes); err != nil {
		return nil, err
	}
	sk, err := new(SigningKey).FromBytes(skBytes)
	if err != nil {
		return nil, err
	}

	pkBytes := make([]byte, 160) // Assuming the size of VerificationKeyPoP bytes is 160
	if _, err := reader.Read(pkBytes); err != nil {
		return nil, err
	}
	pk, err := new(StmVerificationKeyPoP).FromBytes(pkBytes)
	if err != nil {
		return nil, err
	}

	return &StmInitializer{
		Stake:  stake,
		Params: params,
		Sk:     sk,
		Pk:     pk,
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

	// Assuming toCommitmentBatchCompat method exists and properly converts the Merkle tree state.
	msgp := s.ClosedReg.MerkleTree.ToCommitmentBatchCompat().ConcatWithMsg(msg)
	signature, err := s.CoreSign(msgp, s.ClosedReg.TotalStake)
	if err != nil {
		return nil, err
	}

	return signature, nil
}

// A core signature generated without closed registration.
// The core signature can be verified by core verifier.
// Once the signature is produced, this function checks whether any index in `[0,..,self.params.m]`
// wins the lottery by evaluating the dense mapping.
// It records all the winning indexes in `Self.indexes`.
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
		if EvLtPhi(s.Params.PhiF, ev, s.Stake, totalStake) {
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

// Create a Clerk from a signer.
func FromSigner(signer *StmSigner) (*StmClerk, error) {
	if signer.ClosedReg == nil {
		return nil, fmt.Errorf("core signer does not include closed registration")
	}
	return &StmClerk{
		Params:    signer.Params,
		ClosedReg: signer.ClosedReg,
	}, nil
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

	uniqueSigs, err := new(CoreVerifier).DedupSigsForIndices(clerk.ClosedReg.TotalStake, clerk.Params, msgp, sigRegList)
	if err != nil {
		return nil, err
	}

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
	return new(StmAggrVerificationKey).From(clerk.ClosedReg)
}

// Get the (VK, stake) of a party given its index.
func (clerk *StmClerk) GetRegParty(partyIndex uint64) (*StmVerificationKey, Stake, bool) {
	if partyIndex < uint64(len(clerk.ClosedReg.RegParties)) {
		regParty := clerk.ClosedReg.RegParties[partyIndex]
		return regParty.VerificationKey, regParty.Stake, true
	}
	return nil, 0, false
}

// ====================== StmSig implementation ======================
// Verify an stm signature by checking that the lottery was won, the merkle path is correct,
// the indexes are in the desired range and the underlying multi signature validates.
func (sig *StmSig) Verify(params *StmParameters, pk *StmVerificationKey, stake Stake, avk *StmAggrVerificationKey, msg []byte) error {
	msgp := avk.MTCommitment.ConcatWithMsg(msg)
	if err := sig.VerifyCore(params, pk, stake, msgp, avk.TotalStake); err != nil {
		return err
	}
	return nil
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
			return fmt.Errorf("lottery check failed")
		}
	}
	return nil
}

// Convert an `StmSig` into bytes
//
// # Layout
// * Stake
// * Number of valid indexes (as u64)
// * Indexes of the signature
// * Public Key
// * Signature
// * Merkle index of the signer.
func (sig *StmSig) ToBytes() []byte {
	buffer := new(bytes.Buffer)
	binary.Write(buffer, binary.BigEndian, uint64(len(sig.Indexes)))
	for _, index := range sig.Indexes {
		binary.Write(buffer, binary.BigEndian, index)
	}
	buffer.Write(sig.Sigma.ToBytes())
	binary.Write(buffer, binary.BigEndian, sig.SignerIndex)
	return buffer.Bytes()
}

// Extract a batch compatible `StmSig` from a byte slice.
func (s *StmSig) FromBytes(data []byte) (*StmSig, error) {
	reader := bytes.NewReader(data)
	var count uint64
	if err := binary.Read(reader, binary.BigEndian, &count); err != nil {
		return nil, err
	}
	indexes := make([]Index, count)
	for i := range indexes {
		if err := binary.Read(reader, binary.BigEndian, &indexes[i]); err != nil {
			return nil, err
		}
	}
	sigma := new(Signature) // Assuming Signature has a FromBytes method
	offset := 8 + count*8
	if _, err := sigma.FromBytes(data[offset : offset+48]); err != nil { // Define SignatureLength according to the actual size
		return nil, err
	}
	var signerIndex Index
	if err := binary.Read(reader, binary.BigEndian, &signerIndex); err != nil {
		return nil, err
	}

	s.Sigma = sigma
	s.Indexes = indexes
	s.SignerIndex = signerIndex
	return s, nil
}

// Compare two `StmSig` by their signers' merkle tree indexes.
func (sig *StmSig) CmpStmSig(other *StmSig) int {
	if sig.SignerIndex < other.SignerIndex {
		return -1
	}
	if sig.SignerIndex > other.SignerIndex {
		return 1
	}
	return 0
}

// Verify a core signature by checking that the lottery was won,
// the indexes are in the desired range and the underlying multi signature validates.
func (sig *StmSig) VerifyCore(params *StmParameters, pk *StmVerificationKey, stake Stake, msg []byte, totalStake Stake) error {
	if err := sig.Sigma.Verify(msg, pk); err != nil {
		return err
	}
	return sig.CheckIndices(params, stake, msg, totalStake)
}

// Hash returns a hash of the StmSig based primarily on its Sigma field.
func (sig *StmSig) Hash(h hash.Hash) []byte {
	h.Reset()
	h.Write(sig.Sigma.ToBytes()) // Assuming Sigma has a ToBytes that returns its byte representation
	return h.Sum(nil)
}

// Equals checks if two StmSig are equivalent, based primarily on their Sigma field.
func (sig *StmSig) Eq(other *StmSig) bool {
	return bytes.Equal(sig.Sigma.ToBytes(), other.Sigma.ToBytes()) // Assuming ToBytes returns a comparable byte slice
}

func (sig *StmSig) PartialCmp(other *StmSig) int {
	return sig.Cmp(other)
}

// CompareTo provides ordering for StmSig types based on the signer's Merkle tree index.
func (sig *StmSig) Cmp(other *StmSig) int {
	if sig.SignerIndex < other.SignerIndex {
		return -1
	}
	if sig.SignerIndex > other.SignerIndex {
		return 1
	}
	return 0
}

// ====================== StmSigRegParty implementation ======================
// / Convert StmSigRegParty to bytes
// / # Layout
// / * RegParty
// / * Signature
func (srp *StmSigRegParty) ToBytes() []byte {
	regPartyBytes := srp.RegParty.ToBytes()
	sigBytes := srp.Sig.ToBytes()

	out := append(regPartyBytes, sigBytes...)
	return out
}

// /Extract a `StmSigRegParty` from a byte slice.
func (srp *StmSigRegParty) FromBytes(bytes []byte) (*StmSigRegParty, error) {
	if len(bytes) < 104 {
		return nil, errors.New("invalid byte slice length")
	}

	regParty, err := new(RegParty).FromBytes(bytes[:104])
	if err != nil {
		return nil, err
	}

	sig, err := new(StmSig).FromBytes(bytes[104:])
	if err != nil {
		return nil, err
	}

	srp.RegParty = regParty
	srp.Sig = sig

	return srp, nil
}

// ====================== StmAggrSig implementation ======================
// / Verify all checks from signatures, except for the signature verification itself.
// /
// / Indices and quorum are checked by `CoreVerifier::preliminary_verify` with `msgp`.
// / It collects leaves from signatures and checks the batch proof.
// / After batch proof is checked, it collects and returns the signatures and
// / verification keys to be used by aggregate verification.
func (sa *StmAggrSig) PreliminaryVerify(msg []byte, avk *StmAggrVerificationKey, parameters *StmParameters) ([]Signature, []VerificationKey, error) {
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

	return new(CoreVerifier).CollectSigsVKs(sa.Signatures)
}

// / Verify aggregate signature, by checking that
// / * each signature contains only valid indices,
// / * the lottery is indeed won by each one of them,
// / * the merkle tree path is valid,
// / * the aggregate signature validates with respect to the aggregate verification key
// / (aggregation is computed using functions `MSP.BKey` and `MSP.BSig` as described in Section 2.4 of the paper).
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

// / Batch verify a set of signatures, with different messages and avks.
func (sa *StmAggrSig) BatchVerify(stmSignatures []*StmAggrSig, msgs [][]byte, avks []*StmAggrVerificationKey, parameters []*StmParameters) error {
	batchSize := len(stmSignatures)
	if batchSize != len(msgs) || batchSize != len(avks) || batchSize != len(parameters) {
		return errors.New("number of messages, avks, and parameters should correspond to size of the batch")
	}

	var aggrSigs []Signature
	var aggrVks []VerificationKey
	for idx, sigGroup := range stmSignatures {
		if _, _, err := sigGroup.PreliminaryVerify(msgs[idx], avks[idx], parameters[idx]); err != nil {
			return err
		}

		var groupedSigs []Signature
		var groupedVks []VerificationKey
		for _, sigReg := range sigGroup.Signatures {
			groupedSigs = append(groupedSigs, *sigReg.Sig.Sigma)
			groupedVks = append(groupedVks, *sigReg.RegParty.VerificationKey)
		}

		aggrVk, aggrSig, err := new(Signature).Aggregate(groupedVks, groupedSigs)
		if err != nil {
			return err
		}
		aggrSigs = append(aggrSigs, *aggrSig)
		aggrVks = append(aggrVks, *aggrVk)
	}

	var concatMsgs [][]byte
	for i, msg := range msgs {
		concatMsgs = append(concatMsgs, avks[i].MTCommitment.ConcatWithMsg(msg))
	}

	if err := new(Signature).BatchVerifyAggregates(concatMsgs, aggrVks, aggrSigs); err != nil {
		return err
	}
	return nil
}

// / Convert multi signature to bytes
// / # Layout
// / * Number of the pairs of Signatures and Registered Parties (SigRegParty) (as u64)
// / * Size of a pair of Signature and Registered Party
// / * Pairs of Signatures and Registered Parties
// / * Batch proof
func (sa *StmAggrSig) ToBytes() ([]byte, error) {
	buf := new(bytes.Buffer)
	if err := binary.Write(buf, binary.BigEndian, uint64(len(sa.Signatures))); err != nil {
		return nil, err
	}

	if len(sa.Signatures) > 0 {
		firstSigBytes := sa.Signatures[0].ToBytes()
		if err := binary.Write(buf, binary.BigEndian, uint64(len(firstSigBytes))); err != nil {
			return nil, err
		}
		for _, sigReg := range sa.Signatures {
			sigBytes := sigReg.ToBytes()
			if _, err := buf.Write(sigBytes); err != nil {
				return nil, err
			}
		}
	}

	proofBytes := sa.BatchProof.ToBytes()
	if _, err := buf.Write(proofBytes); err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

// /Extract a `StmAggrSig` from a byte slice.
func (sa *StmAggrSig) FromBytes(data []byte) (*StmAggrSig, error) {
	buf := bytes.NewBuffer(data)
	var numSig uint64
	if err := binary.Read(buf, binary.BigEndian, &numSig); err != nil {
		return nil, err
	}

	var sigSize uint64
	if err := binary.Read(buf, binary.BigEndian, &sigSize); err != nil {
		return nil, err
	}

	sigRegList := make([]StmSigRegParty, numSig)
	for i := uint64(0); i < numSig; i++ {
		sigBytes := make([]byte, sigSize)
		if _, err := buf.Read(sigBytes); err != nil {
			return nil, err
		}
		sigReg, err := new(StmSigRegParty).FromBytes(sigBytes)
		if err != nil {
			return nil, err
		}
		sigRegList[i] = *sigReg
	}

	batchProofBytes := buf.Bytes()
	batchProof, err := new(BatchPath).FromBytes(batchProofBytes)
	if err != nil {
		return nil, err
	}

	sa.Signatures = sigRegList
	sa.BatchProof = batchProof

	return sa, nil
}

// ====================== CoreVerifier implementation ======================

func (cv *CoreVerifier) DedupSigsForIndices(totalStake Stake, params *StmParameters, msg []byte, sigs []StmSigRegParty) ([]StmSigRegParty, error) {
	return nil, nil
}

func (cv *CoreVerifier) PreliminaryVerify(totalStake Stake, signatures []StmSigRegParty, params *StmParameters, msg []byte) error {
	return nil
}

func (cv *CoreVerifier) CollectSigsVKs(sigs []StmSigRegParty) ([]Signature, []VerificationKey, error) {
	return nil, nil, nil
}

func (savk *StmAggrVerificationKey) From(reg *ClosedKeyReg) *StmAggrVerificationKey {
	savk.MTCommitment = reg.MerkleTree.ToCommitmentBatchCompat()
	savk.TotalStake = reg.TotalStake
	return savk
}
