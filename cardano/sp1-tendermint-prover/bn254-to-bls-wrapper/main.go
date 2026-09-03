package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"time"

	"github.com/consensys/gnark-crypto/ecc"
	bls12381curve "github.com/consensys/gnark-crypto/ecc/bls12-381"
	bn254curve "github.com/consensys/gnark-crypto/ecc/bn254"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	groth16bls12381 "github.com/consensys/gnark/backend/groth16/bls12-381"
	groth16bn254 "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/debug"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	gnarklogger "github.com/consensys/gnark/logger"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

// This is sp1-verifier 6.1.0's groth16_vk.bin, encoded as hex so this study is
// self-contained. SHA-256: 4388a21c687fdd5f218d7e3d13190cac4c5355818d3605fd5fb811df468ee696.
const sp1Groth16VKHex = "e1c7d728a5fd961fc179ec5eab938f564deba5b271e1c90c2c29a79648418fc182e78e216b27cb2b30abd22d17fb65b747ad8050d18e543498522d01a2c3fe79dc3c9339849225980c7d3f824f80d19e2a9c2554b6ab2160fa9635528f693fc00d964538da2653f2e62499571e6c78afb8909d3ea8107f306bd6928253680a3a998e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6edd7e00b2ca4f62668135017ed8a68894e104ac26dfd9bf376634b42af9e5ae50e91b7e9276171bb0efd647fc63e38bbfba3076f20daca8cd52bcc7284d9b1c6eb1723616533dd6ae53502c9c506a81f23f543d68750b5133ebfbe1f4746b3b01100000006acd6bf7f164af0b6b0bbbe0fdcb06ee0c1ba07f8e6eb2f9f3943a90cb1d402908f5460f3b7221705435e745da21e276536379c0113c13c4255e7ae101f1e90bf8b0ae6e491bc04c544da9e8cd4857d201b4cfa0222dbe96aac97f044fdf1c922c97c875a6ebd0999b06e7267ff3d8a6bf859bb9635abae07cb6b3534ba409a839807204ddcd27506ba72e17b55227b0bf310136ecb40c74acd52f3ccfbcba9f7808c7b7c98d78c07a2c4be5f6be7082ba41021611f9a2dfc016f8bbb37d36bee0000000000000000"

// This is sp1-verifier 6.1.0's independently fixed VK_ROOT_BYTES value, not
// a value learned from the proof being wrapped.
const sp1VKRootHex = "002f850ee998974d6cc00e50cd0814b098c05bfade466d28573240d057f25352"

const cardanoCommitmentHashDomain = "cardano-ibc:gnark-bsb22:v1:"
const workerProtocol = "cardano-ibc-bn254-to-bls-wrapper/v1"

type fixtureJSON struct {
	UpdateClientVKey string `json:"updateClientVkey"`
	UpdateMsg        string `json:"updateMsg"`
}

type fixtureData struct {
	programVKey      []byte
	publicValues     []byte
	proof            []byte
	publicInputs     [5]*big.Int
	expectedVKRoot   *big.Int
	programVKeyLabel string
}

// publicInputShape is not the circuit SP1 proved. It only gives gnark the five
// public-wire shapes needed by its recursive Groth16 verifier.
type publicInputShape struct {
	ProgramVKey        frontend.Variable `gnark:",public"`
	PublicValuesDigest frontend.Variable `gnark:",public"`
	ExitCode           frontend.Variable `gnark:",public"`
	VKRoot             frontend.Variable `gnark:",public"`
	Nonce              frontend.Variable `gnark:",public"`
}

func (*publicInputShape) Define(frontend.API) error { return nil }

type outerCircuit struct {
	Proof        stdgroth16.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine]
	InnerWitness stdgroth16.Witness[sw_bn254.ScalarField]

	// Only the two values the Cardano validator must bind are public in the
	// outer proof. exitCode and vkRoot are constrained below; nonce stays private.
	ProgramVKey        frontend.Variable `gnark:",public"`
	PublicValuesDigest frontend.Variable `gnark:",public"`

	vk             stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl] `gnark:"-"`
	expectedVKRoot *big.Int                                                                     `gnark:"-"`
}

func (c *outerCircuit) Define(api frontend.API) error {
	if len(c.InnerWitness.Public) != 5 {
		return fmt.Errorf("expected five SP1 public inputs, got %d", len(c.InnerWitness.Public))
	}

	field, err := emulated.NewField[sw_bn254.ScalarField](api)
	if err != nil {
		return fmt.Errorf("create BN254 scalar field emulator: %w", err)
	}
	for i := range c.InnerWitness.Public {
		field.AssertIsInRange(&c.InnerWitness.Public[i])
	}

	programVKey := field.FromBits(api.ToBinary(c.ProgramVKey, 254)...)
	publicValuesDigest := field.FromBits(api.ToBinary(c.PublicValuesDigest, 254)...)
	field.AssertIsInRange(programVKey)
	field.AssertIsInRange(publicValuesDigest)
	field.AssertIsEqual(&c.InnerWitness.Public[0], programVKey)
	field.AssertIsEqual(&c.InnerWitness.Public[1], publicValuesDigest)
	field.AssertIsEqual(&c.InnerWitness.Public[2], field.Zero())
	field.AssertIsEqual(&c.InnerWitness.Public[3], field.NewElement(c.expectedVKRoot))

	verifier, err := stdgroth16.NewVerifier[
		sw_bn254.ScalarField,
		sw_bn254.G1Affine,
		sw_bn254.G2Affine,
		sw_bn254.GTEl,
	](api)
	if err != nil {
		return fmt.Errorf("create in-circuit BN254 Groth16 verifier: %w", err)
	}
	return verifier.AssertProof(c.vk, c.Proof, c.InnerWitness, stdgroth16.WithCompleteArithmetic())
}

type cardanoProofJSON struct {
	A                     string   `json:"a"`
	B                     string   `json:"b"`
	C                     string   `json:"c"`
	Commitments           []string `json:"commitments"`
	CommitmentPoK         string   `json:"commitment_pok"`
	CommitmentHashScalars []string `json:"commitment_hash_scalars"`
}

type cardanoCommitmentVKJSON struct {
	G         string `json:"g"`
	GSigmaNeg string `json:"g_sigma_neg"`
}

type cardanoVKJSON struct {
	AlphaG1                      string                    `json:"alpha_g1"`
	BetaG2                       string                    `json:"beta_g2"`
	GammaG2                      string                    `json:"gamma_g2"`
	DeltaG2                      string                    `json:"delta_g2"`
	IC                           []string                  `json:"ic"`
	NPublic                      int                       `json:"n_public"`
	CommitmentKeys               []cardanoCommitmentVKJSON `json:"commitment_keys"`
	PublicAndCommitmentCommitted [][]int                   `json:"public_and_commitment_committed"`
	CommitmentHashDomain         string                    `json:"commitment_hash_domain"`
}

type serializedWriter interface {
	WriteTo(io.Writer) (int64, error)
}

type serializedReader interface {
	ReadFrom(io.Reader) (int64, error)
}

type keyFileMetadata struct {
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type outerKeyMetadata struct {
	Curve            string                     `json:"curve"`
	DevelopmentSetup bool                       `json:"development_setup"`
	Constraints      int                        `json:"constraints"`
	Files            map[string]keyFileMetadata `json:"files"`
}

type workerRequest struct {
	RequestID   string       `json:"requestId,omitempty"`
	Fixture     *fixtureJSON `json:"fixture,omitempty"`
	FixturePath string       `json:"fixturePath,omitempty"`
	OutDir      string       `json:"outDir,omitempty"`
}

type workerResponse struct {
	RequestID      string  `json:"requestId,omitempty"`
	OK             bool    `json:"ok"`
	WrappedProof   string  `json:"wrappedProof,omitempty"`
	ProgramVKey    string  `json:"programVkey,omitempty"`
	PublicValues   string  `json:"publicValues,omitempty"`
	ElapsedSeconds float64 `json:"elapsedSeconds,omitempty"`
	Error          string  `json:"error,omitempty"`
}

type workerReady struct {
	Ready                 bool   `json:"ready"`
	Protocol              string `json:"protocol"`
	VerificationKeySHA256 string `json:"verificationKeySha256"`
}

type workerProofResult struct {
	proofBytes []byte
	fixture    *fixtureData
	elapsed    time.Duration
}

type outerWorker struct {
	innerVK        groth16.VerifyingKey
	circuitVK      stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl]
	expectedVKRoot *big.Int
	outerCCS       constraint.ConstraintSystem
	outerPK        groth16.ProvingKey
	outerVK        groth16.VerifyingKey
	log            io.Writer
}

func main() {
	var (
		fixturePath = flag.String("fixture", "../../../studies/sp1_tendermint_cardano/fixtures/update_client_fixture-groth16.json", "Eureka update-client Groth16 fixture")
		prove       = flag.Bool("prove", false, "generate and verify an outer proof using a fixed key directory")
		keyDir      = flag.String("key-dir", "", "gitignored directory containing the fixed outer CCS, proving key, and verifying key")
		setupKeys   = flag.Bool("setup-keys", false, "create the fixed development keys; refuses to overwrite existing key files")
		outDir      = flag.String("out", "", "optional directory for Cardano-formatted proof and VK artifacts")
		workerMode  = flag.Bool("worker", false, "load fixed outer proving artifacts once and serve JSON-lines proof requests on stdin")
	)
	flag.Parse()

	var err error
	if *workerMode {
		err = runWorker(*keyDir, *setupKeys, os.Stdin, os.Stdout, os.Stderr)
	} else {
		err = run(*fixturePath, *prove, *keyDir, *setupKeys, *outDir)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(fixturePath string, doProve bool, keyDir string, setupKeys bool, outDir string) error {
	if setupKeys && !doProve {
		return errors.New("-setup-keys requires -prove")
	}
	if doProve && keyDir == "" {
		return errors.New("-prove requires -key-dir so proofs reuse a stable outer verifying key")
	}
	fixture, err := loadFixture(fixturePath)
	if err != nil {
		return err
	}
	if outDir != "" {
		if err := writePublicValuesArtifacts(outDir, fixture.publicValues); err != nil {
			return err
		}
	}
	innerVK, err := loadSP1VerifyingKey()
	if err != nil {
		return err
	}
	innerProof, err := loadSP1Proof(fixture.proof)
	if err != nil {
		return err
	}
	innerWitness, err := newInnerWitness(fixture.publicInputs)
	if err != nil {
		return err
	}
	innerPublicWitness, err := innerWitness.Public()
	if err != nil {
		return fmt.Errorf("extract SP1 public witness: %w", err)
	}
	if err := groth16.Verify(innerProof, innerVK, innerPublicWitness); err != nil {
		return fmt.Errorf("native verification of Eureka SP1 proof: %w", err)
	}
	fmt.Println("inner_native_verified: true")

	innerShape, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &publicInputShape{})
	if err != nil {
		return fmt.Errorf("compile five-public-input shape: %w", err)
	}
	circuitVK, err := stdgroth16.ValueOfVerifyingKey[
		sw_bn254.G1Affine,
		sw_bn254.G2Affine,
		sw_bn254.GTEl,
	](innerVK)
	if err != nil {
		return fmt.Errorf("convert SP1 verification key: %w", err)
	}
	circuitProof, err := stdgroth16.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](innerProof)
	if err != nil {
		return fmt.Errorf("convert SP1 proof: %w", err)
	}
	circuitWitness, err := stdgroth16.ValueOfWitness[sw_bn254.ScalarField](innerWitness)
	if err != nil {
		return fmt.Errorf("convert SP1 public witness: %w", err)
	}

	outerTemplate := &outerCircuit{
		Proof:          stdgroth16.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](innerShape),
		InnerWitness:   stdgroth16.PlaceholderWitness[sw_bn254.ScalarField](innerShape),
		vk:             circuitVK,
		expectedVKRoot: fixture.expectedVKRoot,
	}
	outerAssignment := &outerCircuit{
		Proof:              circuitProof,
		InnerWitness:       circuitWitness,
		ProgramVKey:        fixture.publicInputs[0],
		PublicValuesDigest: fixture.publicInputs[1],
		vk:                 circuitVK,
		expectedVKRoot:     fixture.expectedVKRoot,
	}

	started := time.Now()
	outerCCS, err := frontend.Compile(ecc.BLS12_381.ScalarField(), r1cs.NewBuilder, outerTemplate)
	if err != nil {
		return fmt.Errorf("compile BLS12-381 outer circuit: %w", err)
	}
	fmt.Printf("outer_compile_seconds: %.3f\n", time.Since(started).Seconds())
	fmt.Printf("outer_constraints: %d\n", outerCCS.GetNbConstraints())
	fmt.Printf("outer_public_variables_including_one_wire: %d\n", outerCCS.GetNbPublicVariables())
	fmt.Printf("outer_secret_variables: %d\n", outerCCS.GetNbSecretVariables())
	fmt.Printf("outer_internal_variables: %d\n", outerCCS.GetNbInternalVariables())
	nbCommitments := len(outerCCS.GetCommitments().CommitmentIndexes())
	fmt.Printf("outer_commitments: %d\n", nbCommitments)

	outerWitness, err := frontend.NewWitness(outerAssignment, ecc.BLS12_381.ScalarField())
	if err != nil {
		return fmt.Errorf("create BLS12-381 outer witness: %w", err)
	}
	if nbCommitments == 0 || debug.Debug {
		started = time.Now()
		if _, err := outerCCS.Solve(outerWitness); err != nil {
			return fmt.Errorf("solve BLS12-381 outer circuit: %w", err)
		}
		fmt.Printf("outer_solve_seconds: %.3f\n", time.Since(started).Seconds())
		fmt.Println("outer_constraints_satisfied: true")
	} else {
		fmt.Println("outer_direct_solve_skipped: gnark commitment hint is populated by Groth16 Prove")
	}

	if !doProve {
		return nil
	}

	outerCCS, outerPK, outerVK, err := fixedOuterKeys(outerCCS, keyDir, setupKeys, os.Stdout)
	if err != nil {
		return err
	}

	started = time.Now()
	outerProof, err := groth16.Prove(
		outerCCS,
		outerPK,
		outerWitness,
		backend.WithProverHashToFieldFunction(newCardanoCommitmentHasher()),
	)
	if err != nil {
		return fmt.Errorf("create BLS12-381 outer proof: %w", err)
	}
	fmt.Printf("outer_prove_seconds: %.3f\n", time.Since(started).Seconds())

	outerPublicWitness, err := outerWitness.Public()
	if err != nil {
		return fmt.Errorf("extract BLS12-381 public witness: %w", err)
	}
	started = time.Now()
	if err := groth16.Verify(
		outerProof,
		outerVK,
		outerPublicWitness,
		backend.WithVerifierHashToFieldFunction(newCardanoCommitmentHasher()),
	); err != nil {
		return fmt.Errorf("verify BLS12-381 outer proof: %w", err)
	}
	fmt.Printf("outer_verify_seconds: %.3f\n", time.Since(started).Seconds())
	fmt.Println("outer_bls12_381_verified: true")

	proofBytes, proofJSON, vkJSON, err := cardanoArtifacts(outerProof, outerVK)
	if err != nil {
		return err
	}
	fmt.Printf("cardano_extended_proof_bytes: %d\n", len(proofBytes))
	fmt.Printf("cardano_vk_ic_points: %d\n", len(vkJSON.IC))

	if outDir != "" {
		if err := writeArtifacts(outDir, proofBytes, proofJSON, vkJSON, fixture.publicInputs[:2]); err != nil {
			return err
		}
		fmt.Printf("artifacts: %s\n", outDir)
	}
	return nil
}

func runWorker(
	keyDir string,
	setupKeys bool,
	input io.Reader,
	output io.Writer,
	log io.Writer,
) error {
	if setupKeys {
		return errors.New("-worker cannot be combined with -setup-keys; provision fixed keys with the one-shot CLI first")
	}
	if keyDir == "" {
		return errors.New("-worker requires -key-dir")
	}
	// The default gnark logger writes to stdout. Reserve stdout for the
	// JSON-lines protocol and keep all circuit/prover diagnostics on stderr.
	gnarklogger.SetOutput(log)
	worker, err := newOuterWorker(keyDir, log)
	if err != nil {
		return err
	}
	verificationKey, err := cardanoVerificationKey(worker.outerVK)
	if err != nil {
		return err
	}
	encodedVerificationKey, err := encodeCardanoVerificationKey(verificationKey)
	if err != nil {
		return err
	}
	verificationKeySHA256 := sha256.Sum256(encodedVerificationKey)
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(workerReady{
		Ready:                 true,
		Protocol:              workerProtocol,
		VerificationKeySHA256: hex.EncodeToString(verificationKeySHA256[:]),
	}); err != nil {
		return fmt.Errorf("encode worker readiness: %w", err)
	}
	fmt.Fprintln(log, "worker_ready: true")
	return serveWorker(input, output, worker.prove)
}

func newOuterWorker(keyDir string, log io.Writer) (*outerWorker, error) {
	innerVK, err := loadSP1VerifyingKey()
	if err != nil {
		return nil, err
	}
	innerShape, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &publicInputShape{})
	if err != nil {
		return nil, fmt.Errorf("compile five-public-input shape: %w", err)
	}
	circuitVK, err := stdgroth16.ValueOfVerifyingKey[
		sw_bn254.G1Affine,
		sw_bn254.G2Affine,
		sw_bn254.GTEl,
	](innerVK)
	if err != nil {
		return nil, fmt.Errorf("convert SP1 verification key: %w", err)
	}
	expectedVKRootBytes, err := hex.DecodeString(sp1VKRootHex)
	if err != nil {
		return nil, fmt.Errorf("decode fixed SP1 verification-key root: %w", err)
	}
	expectedVKRoot := new(big.Int).SetBytes(expectedVKRootBytes)
	outerTemplate := &outerCircuit{
		Proof:          stdgroth16.PlaceholderProof[sw_bn254.G1Affine, sw_bn254.G2Affine](innerShape),
		InnerWitness:   stdgroth16.PlaceholderWitness[sw_bn254.ScalarField](innerShape),
		vk:             circuitVK,
		expectedVKRoot: expectedVKRoot,
	}

	started := time.Now()
	compiledCCS, err := frontend.Compile(ecc.BLS12_381.ScalarField(), r1cs.NewBuilder, outerTemplate)
	if err != nil {
		return nil, fmt.Errorf("compile BLS12-381 outer circuit: %w", err)
	}
	fmt.Fprintf(log, "outer_compile_seconds: %.3f\n", time.Since(started).Seconds())
	fmt.Fprintf(log, "outer_constraints: %d\n", compiledCCS.GetNbConstraints())
	fmt.Fprintf(log, "outer_public_variables_including_one_wire: %d\n", compiledCCS.GetNbPublicVariables())
	fmt.Fprintf(log, "outer_secret_variables: %d\n", compiledCCS.GetNbSecretVariables())
	fmt.Fprintf(log, "outer_internal_variables: %d\n", compiledCCS.GetNbInternalVariables())
	fmt.Fprintf(log, "outer_commitments: %d\n", len(compiledCCS.GetCommitments().CommitmentIndexes()))

	outerCCS, outerPK, outerVK, err := fixedOuterKeys(compiledCCS, keyDir, false, log)
	if err != nil {
		return nil, err
	}
	if outerPK.CurveID() != ecc.BLS12_381 {
		return nil, fmt.Errorf("fixed outer proving key uses %s, expected BLS12-381", outerPK.CurveID())
	}
	if outerVK.CurveID() != ecc.BLS12_381 {
		return nil, fmt.Errorf("fixed outer verification key uses %s, expected BLS12-381", outerVK.CurveID())
	}
	if outerVK.NbPublicWitness() != compiledCCS.GetNbPublicVariables() {
		return nil, fmt.Errorf(
			"fixed outer verification key has %d public wires including the one wire, compiled circuit has %d",
			outerVK.NbPublicWitness(),
			compiledCCS.GetNbPublicVariables(),
		)
	}
	return &outerWorker{
		innerVK:        innerVK,
		circuitVK:      circuitVK,
		expectedVKRoot: expectedVKRoot,
		outerCCS:       outerCCS,
		outerPK:        outerPK,
		outerVK:        outerVK,
		log:            log,
	}, nil
}

func (w *outerWorker) prove(request workerRequest) (workerProofResult, error) {
	startedTotal := time.Now()
	fixture, err := loadWorkerFixture(request)
	if err != nil {
		return workerProofResult{}, err
	}
	if request.OutDir != "" {
		if err := writePublicValuesArtifacts(request.OutDir, fixture.publicValues); err != nil {
			return workerProofResult{}, err
		}
	}

	innerProof, err := loadSP1Proof(fixture.proof)
	if err != nil {
		return workerProofResult{}, err
	}
	innerWitness, err := newInnerWitness(fixture.publicInputs)
	if err != nil {
		return workerProofResult{}, err
	}
	innerPublicWitness, err := innerWitness.Public()
	if err != nil {
		return workerProofResult{}, fmt.Errorf("extract SP1 public witness: %w", err)
	}
	if err := groth16.Verify(innerProof, w.innerVK, innerPublicWitness); err != nil {
		return workerProofResult{}, fmt.Errorf("native verification of Eureka SP1 proof: %w", err)
	}
	fmt.Fprintln(w.log, "inner_native_verified: true")

	circuitProof, err := stdgroth16.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](innerProof)
	if err != nil {
		return workerProofResult{}, fmt.Errorf("convert SP1 proof: %w", err)
	}
	circuitWitness, err := stdgroth16.ValueOfWitness[sw_bn254.ScalarField](innerWitness)
	if err != nil {
		return workerProofResult{}, fmt.Errorf("convert SP1 public witness: %w", err)
	}
	outerAssignment := &outerCircuit{
		Proof:              circuitProof,
		InnerWitness:       circuitWitness,
		ProgramVKey:        fixture.publicInputs[0],
		PublicValuesDigest: fixture.publicInputs[1],
		vk:                 w.circuitVK,
		expectedVKRoot:     w.expectedVKRoot,
	}
	outerWitness, err := frontend.NewWitness(outerAssignment, ecc.BLS12_381.ScalarField())
	if err != nil {
		return workerProofResult{}, fmt.Errorf("create BLS12-381 outer witness: %w", err)
	}

	started := time.Now()
	outerProof, err := groth16.Prove(
		w.outerCCS,
		w.outerPK,
		outerWitness,
		backend.WithProverHashToFieldFunction(newCardanoCommitmentHasher()),
	)
	if err != nil {
		return workerProofResult{}, fmt.Errorf("create BLS12-381 outer proof: %w", err)
	}
	fmt.Fprintf(w.log, "outer_prove_seconds: %.3f\n", time.Since(started).Seconds())

	outerPublicWitness, err := outerWitness.Public()
	if err != nil {
		return workerProofResult{}, fmt.Errorf("extract BLS12-381 public witness: %w", err)
	}
	started = time.Now()
	if err := groth16.Verify(
		outerProof,
		w.outerVK,
		outerPublicWitness,
		backend.WithVerifierHashToFieldFunction(newCardanoCommitmentHasher()),
	); err != nil {
		return workerProofResult{}, fmt.Errorf("verify BLS12-381 outer proof: %w", err)
	}
	fmt.Fprintf(w.log, "outer_verify_seconds: %.3f\n", time.Since(started).Seconds())
	fmt.Fprintln(w.log, "outer_bls12_381_verified: true")

	proofBytes, proofJSON, vkJSON, err := cardanoArtifacts(outerProof, w.outerVK)
	if err != nil {
		return workerProofResult{}, err
	}
	fmt.Fprintf(w.log, "cardano_extended_proof_bytes: %d\n", len(proofBytes))
	fmt.Fprintf(w.log, "cardano_vk_ic_points: %d\n", len(vkJSON.IC))
	if request.OutDir != "" {
		if err := writeArtifacts(request.OutDir, proofBytes, proofJSON, vkJSON, fixture.publicInputs[:2]); err != nil {
			return workerProofResult{}, err
		}
		fmt.Fprintf(w.log, "artifacts: %s\n", request.OutDir)
	}
	return workerProofResult{
		proofBytes: proofBytes,
		fixture:    fixture,
		elapsed:    time.Since(startedTotal),
	}, nil
}

func loadWorkerFixture(request workerRequest) (*fixtureData, error) {
	if request.Fixture != nil && request.FixturePath != "" {
		return nil, errors.New("request must provide either fixture or fixturePath, not both")
	}
	if request.Fixture != nil {
		return parseFixture(*request.Fixture)
	}
	if request.FixturePath != "" {
		return loadFixture(request.FixturePath)
	}
	return nil, errors.New("request must provide fixture or fixturePath")
}

func serveWorker(
	input io.Reader,
	output io.Writer,
	handler func(workerRequest) (workerProofResult, error),
) error {
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 64*1024), 32*1024*1024)
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	for scanner.Scan() {
		var request workerRequest
		response := workerResponse{}
		err := decodeWorkerRequest(scanner.Bytes(), &request)
		response.RequestID = request.RequestID
		if err != nil {
			response.Error = err.Error()
		} else {
			result, err := handler(request)
			if err != nil {
				response.Error = err.Error()
			} else {
				response.OK = true
				response.WrappedProof = "0x" + hex.EncodeToString(result.proofBytes)
				response.ProgramVKey = result.fixture.programVKeyLabel
				response.PublicValues = "0x" + hex.EncodeToString(result.fixture.publicValues)
				response.ElapsedSeconds = result.elapsed.Seconds()
			}
		}
		if err := encoder.Encode(response); err != nil {
			return fmt.Errorf("encode worker response: %w", err)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read worker request: %w", err)
	}
	return nil
}

func decodeWorkerRequest(line []byte, request *workerRequest) error {
	if len(bytes.TrimSpace(line)) == 0 {
		return errors.New("decode worker request: empty line")
	}
	decoder := json.NewDecoder(bytes.NewReader(line))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(request); err != nil {
		return fmt.Errorf("decode worker request: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("decode worker request: multiple JSON values on one line")
		}
		return fmt.Errorf("decode worker request: %w", err)
	}
	return nil
}

func fixedOuterKeys(
	compiledCCS constraint.ConstraintSystem,
	keyDir string,
	setup bool,
	log io.Writer,
) (constraint.ConstraintSystem, groth16.ProvingKey, groth16.VerifyingKey, error) {
	const (
		ccsName       = "outer.r1cs"
		provingName   = "outer.pk"
		verifyingName = "outer.vk"
		metadataName  = "manifest.json"
	)
	paths := map[string]string{
		ccsName:       filepath.Join(keyDir, ccsName),
		provingName:   filepath.Join(keyDir, provingName),
		verifyingName: filepath.Join(keyDir, verifyingName),
	}

	if setup {
		for name, path := range paths {
			if _, err := os.Stat(path); err == nil {
				return nil, nil, nil, fmt.Errorf("refusing to overwrite existing fixed key file %s", path)
			} else if !errors.Is(err, os.ErrNotExist) {
				return nil, nil, nil, fmt.Errorf("inspect fixed key file %s: %w", name, err)
			}
		}
		// These are public proving artifacts, not setup randomness. The prover
		// container runs as an unprivileged uid and must be able to read the
		// bind-mounted directory created by the host provisioning command.
		if err := os.MkdirAll(keyDir, 0o755); err != nil {
			return nil, nil, nil, fmt.Errorf("create fixed key directory: %w", err)
		}
		if err := os.Chmod(keyDir, 0o755); err != nil {
			return nil, nil, nil, fmt.Errorf("make fixed key directory container-readable: %w", err)
		}

		started := time.Now()
		outerPK, outerVK, err := groth16.Setup(compiledCCS)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("development Groth16 setup: %w", err)
		}
		fmt.Fprintf(log, "outer_setup_seconds: %.3f\n", time.Since(started).Seconds())

		started = time.Now()
		if err := writeSerialized(paths[ccsName], compiledCCS, 0o644); err != nil {
			return nil, nil, nil, fmt.Errorf("persist outer constraint system: %w", err)
		}
		if err := writeSerialized(paths[provingName], outerPK, 0o644); err != nil {
			return nil, nil, nil, fmt.Errorf("persist outer proving key: %w", err)
		}
		if err := writeSerialized(paths[verifyingName], outerVK, 0o644); err != nil {
			return nil, nil, nil, fmt.Errorf("persist outer verifying key: %w", err)
		}
		fmt.Fprintf(log, "outer_key_write_seconds: %.3f\n", time.Since(started).Seconds())
		if err := writeOuterKeyMetadata(
			filepath.Join(keyDir, metadataName),
			compiledCCS.GetNbConstraints(),
			paths,
		); err != nil {
			return nil, nil, nil, err
		}
		if err := validateAndReportOuterKeyMetadata(log, "setup", keyDir, compiledCCS.GetNbConstraints(), paths); err != nil {
			return nil, nil, nil, err
		}
		return compiledCCS, outerPK, outerVK, nil
	}

	started := time.Now()
	outerCCS := groth16.NewCS(ecc.BLS12_381)
	outerPK := groth16.NewProvingKey(ecc.BLS12_381)
	outerVK := groth16.NewVerifyingKey(ecc.BLS12_381)
	if err := readSerialized(paths[ccsName], outerCCS); err != nil {
		return nil, nil, nil, fmt.Errorf("load fixed outer constraint system: %w", err)
	}
	if err := readSerialized(paths[provingName], outerPK); err != nil {
		return nil, nil, nil, fmt.Errorf("load fixed outer proving key: %w", err)
	}
	if err := readSerialized(paths[verifyingName], outerVK); err != nil {
		return nil, nil, nil, fmt.Errorf("load fixed outer verifying key: %w", err)
	}
	fmt.Fprintf(log, "outer_key_load_seconds: %.3f\n", time.Since(started).Seconds())

	compiledHash, err := serializedSHA256(compiledCCS)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("hash compiled outer constraint system: %w", err)
	}
	loadedHash, err := serializedSHA256(outerCCS)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("hash fixed outer constraint system: %w", err)
	}
	if loadedHash != compiledHash {
		return nil, nil, nil, fmt.Errorf(
			"fixed outer constraint system hash %s does not match compiled circuit %s",
			loadedHash,
			compiledHash,
		)
	}
	if err := validateAndReportOuterKeyMetadata(log, "load", keyDir, compiledCCS.GetNbConstraints(), paths); err != nil {
		return nil, nil, nil, err
	}
	return outerCCS, outerPK, outerVK, nil
}

func writeSerialized(path string, value serializedWriter, mode os.FileMode) error {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	complete := false
	defer func() {
		_ = temporary.Close()
		if !complete {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(mode); err != nil {
		return err
	}
	if _, err := value.WriteTo(temporary); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	complete = true
	return nil
}

func readSerialized(path string, value serializedReader) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	read, err := value.ReadFrom(file)
	if err != nil {
		return err
	}
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if read != info.Size() {
		return fmt.Errorf("decoder consumed %d of %d bytes", read, info.Size())
	}
	return nil
}

func serializedSHA256(value serializedWriter) (string, error) {
	digest := sha256.New()
	if _, err := value.WriteTo(digest); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func fileMetadata(path string) (keyFileMetadata, error) {
	file, err := os.Open(path)
	if err != nil {
		return keyFileMetadata{}, err
	}
	defer file.Close()
	digest := sha256.New()
	bytesWritten, err := io.Copy(digest, file)
	if err != nil {
		return keyFileMetadata{}, err
	}
	return keyFileMetadata{Bytes: bytesWritten, SHA256: hex.EncodeToString(digest.Sum(nil))}, nil
}

func validateAndReportOuterKeyMetadata(
	log io.Writer,
	mode string,
	keyDir string,
	constraints int,
	paths map[string]string,
) error {
	manifestPath := filepath.Join(keyDir, "manifest.json")
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("read fixed key manifest %s: %w", manifestPath, err)
	}
	var manifest outerKeyMetadata
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return fmt.Errorf("decode fixed key manifest %s: %w", manifestPath, err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return fmt.Errorf("decode fixed key manifest %s: multiple JSON values", manifestPath)
		}
		return fmt.Errorf("decode fixed key manifest %s: %w", manifestPath, err)
	}
	if manifest.Curve != "bls12-381" {
		return fmt.Errorf("fixed key manifest curve is %q, expected bls12-381", manifest.Curve)
	}
	if manifest.Constraints != constraints {
		return fmt.Errorf(
			"fixed key manifest records %d constraints, compiled circuit has %d",
			manifest.Constraints,
			constraints,
		)
	}
	if len(manifest.Files) != len(paths) {
		return fmt.Errorf("fixed key manifest records %d files, expected %d", len(manifest.Files), len(paths))
	}
	fmt.Fprintf(log, "outer_key_mode: %s\n", mode)
	fmt.Fprintln(log, "outer_key_manifest_validated: true")
	for _, name := range []string{"outer.r1cs", "outer.pk", "outer.vk"} {
		expected, ok := manifest.Files[name]
		if !ok {
			return fmt.Errorf("fixed key manifest is missing %s", name)
		}
		actual, err := fileMetadata(paths[name])
		if err != nil {
			return fmt.Errorf("hash fixed key file %s: %w", paths[name], err)
		}
		if actual != expected {
			return fmt.Errorf(
				"fixed key file %s has %d bytes and SHA-256 %s, manifest expects %d bytes and %s",
				paths[name],
				actual.Bytes,
				actual.SHA256,
				expected.Bytes,
				expected.SHA256,
			)
		}
		fmt.Fprintf(log, "outer_key_%s_bytes: %d\n", name, actual.Bytes)
		fmt.Fprintf(log, "outer_key_%s_sha256: %s\n", name, actual.SHA256)
	}
	return nil
}

func writeOuterKeyMetadata(path string, constraints int, paths map[string]string) error {
	files := make(map[string]keyFileMetadata, len(paths))
	for name, keyPath := range paths {
		metadata, err := fileMetadata(keyPath)
		if err != nil {
			return fmt.Errorf("hash fixed key file %s: %w", keyPath, err)
		}
		files[name] = metadata
	}
	metadata := outerKeyMetadata{
		Curve:            "bls12-381",
		DevelopmentSetup: true,
		Constraints:      constraints,
		Files:            files,
	}
	encoded, err := json.MarshalIndent(metadata, "", "  ")
	if err != nil {
		return fmt.Errorf("encode fixed key manifest: %w", err)
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(path, encoded, 0o644); err != nil {
		return fmt.Errorf("write fixed key manifest: %w", err)
	}
	if err := os.Chmod(path, 0o644); err != nil {
		return fmt.Errorf("make fixed key manifest container-readable: %w", err)
	}
	return nil
}

func loadFixture(path string) (*fixtureData, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read fixture: %w", err)
	}
	var fixture fixtureJSON
	if err := json.Unmarshal(raw, &fixture); err != nil {
		return nil, fmt.Errorf("decode fixture JSON: %w", err)
	}
	return parseFixture(fixture)
}

func parseFixture(fixture fixtureJSON) (*fixtureData, error) {
	encoded, err := decodeHex(fixture.UpdateMsg)
	if err != nil {
		return nil, fmt.Errorf("decode updateMsg: %w", err)
	}
	programVKey, publicValues, proof, err := decodeUpdateMessage(encoded)
	if err != nil {
		return nil, err
	}
	if got := "0x" + hex.EncodeToString(programVKey); got != fixture.UpdateClientVKey {
		return nil, fmt.Errorf("program vkey mismatch: ABI has %s, metadata has %s", got, fixture.UpdateClientVKey)
	}
	if len(proof) != 356 {
		return nil, fmt.Errorf("expected 356-byte SP1 Groth16 proof, got %d", len(proof))
	}
	vkBytes, err := hex.DecodeString(sp1Groth16VKHex)
	if err != nil {
		return nil, fmt.Errorf("decode embedded SP1 verification key: %w", err)
	}
	vkHash := sha256.Sum256(vkBytes)
	if !bytes.Equal(proof[:4], vkHash[:4]) {
		return nil, fmt.Errorf("SP1 proof verification-key prefix is %x, expected %x", proof[:4], vkHash[:4])
	}
	expectedVKRoot, err := hex.DecodeString(sp1VKRootHex)
	if err != nil {
		return nil, fmt.Errorf("decode fixed SP1 verification-key root: %w", err)
	}
	if !bytes.Equal(proof[36:68], expectedVKRoot) {
		return nil, fmt.Errorf("SP1 proof verification-key root is %x, expected %x", proof[36:68], expectedVKRoot)
	}
	digest := sha256.Sum256(publicValues)
	digest[0] &= 0x1f
	inputs := [5]*big.Int{
		new(big.Int).SetBytes(programVKey),
		new(big.Int).SetBytes(digest[:]),
		new(big.Int).SetBytes(proof[4:36]),
		new(big.Int).SetBytes(proof[36:68]),
		new(big.Int).SetBytes(proof[68:100]),
	}
	return &fixtureData{
		programVKey:      programVKey,
		publicValues:     publicValues,
		proof:            proof,
		publicInputs:     inputs,
		expectedVKRoot:   new(big.Int).SetBytes(expectedVKRoot),
		programVKeyLabel: fixture.UpdateClientVKey,
	}, nil
}

func decodeUpdateMessage(encoded []byte) ([]byte, []byte, []byte, error) {
	root, err := abiOffset(encoded, 0, 0)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode MsgUpdateClient offset: %w", err)
	}
	sp1Proof, err := abiOffset(encoded, root, root)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode SP1Proof offset: %w", err)
	}
	if sp1Proof+96 > len(encoded) {
		return nil, nil, nil, errors.New("SP1Proof tuple is truncated")
	}
	programVKey := append([]byte(nil), encoded[sp1Proof:sp1Proof+32]...)
	publicValuesOffset, err := abiOffset(encoded, sp1Proof+32, sp1Proof)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode publicValues offset: %w", err)
	}
	proofOffset, err := abiOffset(encoded, sp1Proof+64, sp1Proof)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode proof offset: %w", err)
	}
	publicValues, err := abiBytes(encoded, publicValuesOffset)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode publicValues: %w", err)
	}
	proof, err := abiBytes(encoded, proofOffset)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("decode proof: %w", err)
	}
	return programVKey, publicValues, proof, nil
}

func abiOffset(encoded []byte, wordOffset, base int) (int, error) {
	if wordOffset < 0 || wordOffset+32 > len(encoded) {
		return 0, errors.New("offset word is out of bounds")
	}
	value := new(big.Int).SetBytes(encoded[wordOffset : wordOffset+32])
	if !value.IsInt64() {
		return 0, errors.New("offset does not fit int64")
	}
	offset := value.Int64()
	if offset < 0 || offset > int64(len(encoded)) {
		return 0, errors.New("offset is out of bounds")
	}
	absolute := int64(base) + offset
	if absolute < 0 || absolute > int64(len(encoded)) {
		return 0, errors.New("absolute offset is out of bounds")
	}
	return int(absolute), nil
}

func abiBytes(encoded []byte, offset int) ([]byte, error) {
	if offset < 0 || offset+32 > len(encoded) {
		return nil, errors.New("byte-array length word is out of bounds")
	}
	length := new(big.Int).SetBytes(encoded[offset : offset+32])
	if !length.IsInt64() {
		return nil, errors.New("byte-array length does not fit int64")
	}
	start := offset + 32
	end := int64(start) + length.Int64()
	if end < int64(start) || end > int64(len(encoded)) {
		return nil, errors.New("byte array is truncated")
	}
	return append([]byte(nil), encoded[start:int(end)]...), nil
}

func loadSP1VerifyingKey() (groth16.VerifyingKey, error) {
	raw, err := hex.DecodeString(sp1Groth16VKHex)
	if err != nil {
		return nil, fmt.Errorf("decode embedded SP1 verification key: %w", err)
	}
	vk := groth16.NewVerifyingKey(ecc.BN254)
	read, err := vk.ReadFrom(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("parse SP1 verification key: %w", err)
	}
	if read != int64(len(raw)) {
		return nil, fmt.Errorf("SP1 verification key consumed %d of %d bytes", read, len(raw))
	}
	return vk, nil
}

func loadSP1Proof(fullProof []byte) (groth16.Proof, error) {
	if len(fullProof) != 356 {
		return nil, fmt.Errorf("expected 356-byte full SP1 proof, got %d", len(fullProof))
	}
	raw := fullProof[100:]
	decoder := bn254curve.NewDecoder(bytes.NewReader(raw))
	proof := &groth16bn254.Proof{}
	if err := decoder.Decode(&proof.Ar); err != nil {
		return nil, fmt.Errorf("decode proof A: %w", err)
	}
	if err := decoder.Decode(&proof.Bs); err != nil {
		return nil, fmt.Errorf("decode proof B: %w", err)
	}
	if err := decoder.Decode(&proof.Krs); err != nil {
		return nil, fmt.Errorf("decode proof C: %w", err)
	}
	if decoder.BytesRead() != int64(len(raw)) {
		return nil, fmt.Errorf("SP1 raw proof consumed %d of %d bytes", decoder.BytesRead(), len(raw))
	}
	return proof, nil
}

func newInnerWitness(inputs [5]*big.Int) (witness.Witness, error) {
	assignment := &publicInputShape{
		ProgramVKey:        inputs[0],
		PublicValuesDigest: inputs[1],
		ExitCode:           inputs[2],
		VKRoot:             inputs[3],
		Nonce:              inputs[4],
	}
	w, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		return nil, fmt.Errorf("create SP1 public witness: %w", err)
	}
	return w, nil
}

// decodeHex accepts the 0x-prefixed strings used in the Eureka fixture.
func decodeHex(value string) ([]byte, error) {
	if len(value) >= 2 && value[:2] == "0x" {
		value = value[2:]
	}
	return hex.DecodeString(value)
}

// cardanoCommitmentHasher is the Fiat-Shamir hash used for gnark's BSB22
// commitment wire in the outer proof. gnark passes an uncompressed BLS12-381
// G1 commitment followed by zero or more fixed-width public scalars. Replacing
// the point with its canonical compressed encoding lets Plutus reproduce the
// transcript from the proof with bls12_381_G1_compress.
type cardanoCommitmentHasher struct {
	data []byte
}

func newCardanoCommitmentHasher() *cardanoCommitmentHasher {
	return &cardanoCommitmentHasher{}
}

func (h *cardanoCommitmentHasher) Write(p []byte) (int, error) {
	h.data = append(h.data, p...)
	return len(p), nil
}

func (h *cardanoCommitmentHasher) Sum(prefix []byte) []byte {
	digest, err := cardanoCommitmentDigest(h.data)
	if err != nil {
		panic(err)
	}
	return append(prefix, digest[:]...)
}

func (h *cardanoCommitmentHasher) Reset()       { h.data = h.data[:0] }
func (*cardanoCommitmentHasher) Size() int      { return sha256.Size }
func (*cardanoCommitmentHasher) BlockSize() int { return sha256.BlockSize }

func cardanoCommitmentDigest(serialized []byte) ([sha256.Size]byte, error) {
	if len(serialized) < bls12381curve.SizeOfG1AffineUncompressed {
		return [sha256.Size]byte{}, fmt.Errorf(
			"commitment transcript has %d bytes, need at least %d",
			len(serialized),
			bls12381curve.SizeOfG1AffineUncompressed,
		)
	}
	var point bls12381curve.G1Affine
	read, err := point.SetBytes(serialized[:bls12381curve.SizeOfG1AffineUncompressed])
	if err != nil {
		return [sha256.Size]byte{}, fmt.Errorf("decode uncompressed BLS12-381 commitment: %w", err)
	}
	if read != bls12381curve.SizeOfG1AffineUncompressed {
		return [sha256.Size]byte{}, fmt.Errorf("commitment decoder consumed %d bytes", read)
	}
	compressed := point.Bytes()
	hasher := sha256.New()
	_, _ = hasher.Write([]byte(cardanoCommitmentHashDomain))
	_, _ = hasher.Write(compressed[:])
	_, _ = hasher.Write(serialized[bls12381curve.SizeOfG1AffineUncompressed:])
	var digest [sha256.Size]byte
	copy(digest[:], hasher.Sum(nil))
	// 253 bits is below the BLS12-381 scalar modulus, so no modular reduction
	// or non-native arithmetic is needed in Plutus.
	digest[0] &= 0x1f
	return digest, nil
}

func cardanoArtifacts(proof groth16.Proof, vk groth16.VerifyingKey) ([]byte, cardanoProofJSON, cardanoVKJSON, error) {
	p, ok := proof.(*groth16bls12381.Proof)
	if !ok {
		return nil, cardanoProofJSON{}, cardanoVKJSON{}, fmt.Errorf("expected BLS12-381 proof, got %T", proof)
	}
	v, ok := vk.(*groth16bls12381.VerifyingKey)
	if !ok {
		return nil, cardanoProofJSON{}, cardanoVKJSON{}, fmt.Errorf("expected BLS12-381 verification key, got %T", vk)
	}
	a := p.Ar.Bytes()
	b := p.Bs.Bytes()
	c := p.Krs.Bytes()
	proofBytes := make([]byte, 0, len(a)+len(b)+len(c))
	proofBytes = append(proofBytes, a[:]...)
	proofBytes = append(proofBytes, b[:]...)
	proofBytes = append(proofBytes, c[:]...)
	commitments := make([]string, len(p.Commitments))
	commitmentHashScalars := make([]string, len(p.Commitments))
	for i := range p.Commitments {
		if len(v.PublicAndCommitmentCommitted[i]) != 0 {
			return nil, cardanoProofJSON{}, cardanoVKJSON{}, fmt.Errorf(
				"artifact export does not yet serialize commitment %d's public transcript fields",
				i,
			)
		}
		point := p.Commitments[i].Bytes()
		proofBytes = append(proofBytes, point[:]...)
		commitments[i] = hex.EncodeToString(point[:])
		digest, err := cardanoCommitmentDigest(p.Commitments[i].Marshal())
		if err != nil {
			return nil, cardanoProofJSON{}, cardanoVKJSON{}, fmt.Errorf("hash commitment %d: %w", i, err)
		}
		commitmentHashScalars[i] = hex.EncodeToString(digest[:])
	}
	commitmentPoK := p.CommitmentPok.Bytes()
	if len(p.Commitments) > 0 {
		proofBytes = append(proofBytes, commitmentPoK[:]...)
	}
	proofJSON := cardanoProofJSON{
		A:                     hex.EncodeToString(a[:]),
		B:                     hex.EncodeToString(b[:]),
		C:                     hex.EncodeToString(c[:]),
		Commitments:           commitments,
		CommitmentPoK:         hex.EncodeToString(commitmentPoK[:]),
		CommitmentHashScalars: commitmentHashScalars,
	}
	vkJSON, err := cardanoVerificationKey(v)
	if err != nil {
		return nil, cardanoProofJSON{}, cardanoVKJSON{}, err
	}
	return proofBytes, proofJSON, vkJSON, nil
}

func cardanoVerificationKey(vk groth16.VerifyingKey) (cardanoVKJSON, error) {
	v, ok := vk.(*groth16bls12381.VerifyingKey)
	if !ok {
		return cardanoVKJSON{}, fmt.Errorf("expected BLS12-381 verification key, got %T", vk)
	}
	if len(v.G1.K) < len(v.CommitmentKeys)+1 {
		return cardanoVKJSON{}, errors.New("BLS12-381 verification key has an invalid public-input shape")
	}
	alpha := v.G1.Alpha.Bytes()
	beta := v.G2.Beta.Bytes()
	gamma := v.G2.Gamma.Bytes()
	delta := v.G2.Delta.Bytes()
	vkJSON := cardanoVKJSON{
		AlphaG1:                      hex.EncodeToString(alpha[:]),
		BetaG2:                       hex.EncodeToString(beta[:]),
		GammaG2:                      hex.EncodeToString(gamma[:]),
		DeltaG2:                      hex.EncodeToString(delta[:]),
		IC:                           make([]string, len(v.G1.K)),
		NPublic:                      len(v.G1.K) - len(v.CommitmentKeys) - 1,
		CommitmentKeys:               make([]cardanoCommitmentVKJSON, len(v.CommitmentKeys)),
		PublicAndCommitmentCommitted: v.PublicAndCommitmentCommitted,
		CommitmentHashDomain:         cardanoCommitmentHashDomain,
	}
	for i := range v.G1.K {
		point := v.G1.K[i].Bytes()
		vkJSON.IC[i] = hex.EncodeToString(point[:])
	}
	for i := range v.CommitmentKeys {
		g := v.CommitmentKeys[i].G.Bytes()
		gSigmaNeg := v.CommitmentKeys[i].GSigmaNeg.Bytes()
		vkJSON.CommitmentKeys[i] = cardanoCommitmentVKJSON{
			G:         hex.EncodeToString(g[:]),
			GSigmaNeg: hex.EncodeToString(gSigmaNeg[:]),
		}
	}
	return vkJSON, nil
}

func encodeCardanoVerificationKey(vk cardanoVKJSON) ([]byte, error) {
	encoded, err := json.MarshalIndent(vk, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode Cardano verification key: %w", err)
	}
	return append(encoded, '\n'), nil
}

func writeArtifacts(outDir string, proofBytes []byte, proof cardanoProofJSON, vk cardanoVKJSON, publicInputs []*big.Int) error {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return fmt.Errorf("create artifact directory: %w", err)
	}
	inputs := make([]string, 0, len(publicInputs)+1)
	inputs = append(inputs, "1")
	for _, input := range publicInputs {
		inputs = append(inputs, input.String())
	}
	files := map[string]any{
		"proof.json":            proof,
		"verification_key.json": vk,
		"public_inputs.json":    inputs,
	}
	for name, value := range files {
		encoded, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return fmt.Errorf("encode %s: %w", name, err)
		}
		encoded = append(encoded, '\n')
		if err := os.WriteFile(filepath.Join(outDir, name), encoded, 0o644); err != nil {
			return fmt.Errorf("write %s: %w", name, err)
		}
		if err := os.Chmod(filepath.Join(outDir, name), 0o644); err != nil {
			return fmt.Errorf("make %s container-readable: %w", name, err)
		}
	}
	if err := os.WriteFile(filepath.Join(outDir, "proof.bin"), proofBytes, 0o644); err != nil {
		return fmt.Errorf("write proof.bin: %w", err)
	}
	return nil
}

func writePublicValuesArtifacts(outDir string, publicValues []byte) error {
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return fmt.Errorf("create artifact directory: %w", err)
	}
	if err := os.WriteFile(filepath.Join(outDir, "public_values.bin"), publicValues, 0o644); err != nil {
		return fmt.Errorf("write public_values.bin: %w", err)
	}
	hexValue := append([]byte(hex.EncodeToString(publicValues)), '\n')
	if err := os.WriteFile(filepath.Join(outDir, "public_values.hex"), hexValue, 0o644); err != nil {
		return fmt.Errorf("write public_values.hex: %w", err)
	}
	return nil
}
