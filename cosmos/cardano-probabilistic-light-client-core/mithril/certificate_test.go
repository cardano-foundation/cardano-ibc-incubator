package mithril

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// Mainnet certificates from epochs 660 and 661 certify the stake distributions
// of epochs 659 and 660, which elect the slot leaders of epochs 661 and 662.
func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	file, err := os.Open("../testdata/mithril/" + name)
	require.NoError(t, err)
	defer file.Close()
	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	data, err := io.ReadAll(reader)
	require.NoError(t, err)
	return data
}

type certificateFixture struct {
	raw    []byte
	fields map[string]any
}

func loadCertificate(t *testing.T, epoch string) certificateFixture {
	t.Helper()
	raw := readFixture(t, "mainnet-epoch-"+epoch+"-certificate.json.gz")
	var fields map[string]any
	require.NoError(t, json.Unmarshal(raw, &fields))
	return certificateFixture{raw: raw, fields: fields}
}

func (c certificateFixture) parts() map[string]any {
	return c.fields["protocol_message"].(map[string]any)["message_parts"].(map[string]any)
}

func (c certificateFixture) parameters() map[string]any {
	return c.fields["metadata"].(map[string]any)["parameters"].(map[string]any)
}

// mutate returns the certificate re-encoded after edit changes a fresh copy.
func (c certificateFixture) mutate(t *testing.T, edit func(fields map[string]any)) string {
	t.Helper()
	var fields map[string]any
	require.NoError(t, json.Unmarshal(c.raw, &fields))
	edit(fields)
	raw, err := json.Marshal(fields)
	require.NoError(t, err)
	return string(raw)
}

func mainnetAnchor(t *testing.T, certificate certificateFixture) Anchor {
	t.Helper()
	params := certificate.parameters()
	hash, err := ProtocolParametersHash(uint64(params["k"].(float64)), uint64(params["m"].(float64)), params["phi_f"].(float64))
	require.NoError(t, err)
	return Anchor{Epoch: 660, AggregateVerificationKey: certificate.fields["aggregate_verification_key"].(string), ProtocolParametersHash: hash}
}

func TestMainnetCertificatesExtendTheAnchor(t *testing.T) {
	first, second := loadCertificate(t, "660"), loadCertificate(t, "661")
	next, distributions, err := VerifyCertificates(mainnetAnchor(t, first), []string{string(first.raw), string(second.raw)})
	require.NoError(t, err)
	require.Equal(t, uint64(662), next.Epoch)
	require.Equal(t, second.parts()["next_aggregate_verification_key"], next.AggregateVerificationKey)
	require.Equal(t, second.parts()["next_protocol_parameters"], next.ProtocolParametersHash)
	require.Equal(t, []StakeDistribution{
		{Epoch: 659, MerkleRoot: first.parts()["cardano_stake_distribution_merkle_root"].(string)},
		{Epoch: 660, MerkleRoot: second.parts()["cardano_stake_distribution_merkle_root"].(string)},
	}, distributions)
	require.Equal(t, uint64(661), distributions[0].LeaderEpoch())
}

func TestMainnetStakeDistributionMatchesItsCertificate(t *testing.T) {
	var artifact struct {
		StakeDistribution map[string]uint64 `json:"stake_distribution"`
	}
	require.NoError(t, json.Unmarshal(readFixture(t, "mainnet-stake-distribution-659.json.gz"), &artifact))
	entries := make([]StakeEntry, 0, len(artifact.StakeDistribution))
	for pool, stake := range artifact.StakeDistribution {
		entries = append(entries, StakeEntry{PoolID: pool, Stake: stake})
	}
	require.Len(t, entries, 2671)
	root, err := StakeDistributionRoot(entries)
	require.NoError(t, err)
	require.Equal(t, loadCertificate(t, "660").parts()["cardano_stake_distribution_merkle_root"], root)

	entries[0].Stake++
	changed, err := StakeDistributionRoot(entries)
	require.NoError(t, err)
	require.NotEqual(t, root, changed)
	_, err = StakeDistributionRoot(append(entries, entries[1]))
	require.ErrorContains(t, err, "duplicate pool ID")
	_, err = StakeDistributionRoot(nil)
	require.Error(t, err)
}

func TestProtocolParametersHashMatchesTheNextEpoch(t *testing.T) {
	params := loadCertificate(t, "661").parameters()
	hash, err := ProtocolParametersHash(uint64(params["k"].(float64)), uint64(params["m"].(float64)), params["phi_f"].(float64))
	require.NoError(t, err)
	require.Equal(t, loadCertificate(t, "660").parts()["next_protocol_parameters"], hash)
	require.Equal(t, uint32(0x00333333), u8f24(0.2))
	require.Equal(t, uint32(0x01000000), u8f24(1))
	// Ties round to even: 2^-25 is half of the smallest U8F24 step.
	require.Equal(t, uint32(0), u8f24(1.0/(1<<25)))
	require.Equal(t, uint32(2), u8f24(3.0/(1<<25)))
	_, err = ProtocolParametersHash(1, 1, 0)
	require.Error(t, err)
}

func TestCertificatesThatDoNotExtendTheAnchorAreRejected(t *testing.T) {
	first, second := loadCertificate(t, "660"), loadCertificate(t, "661")
	anchor := mainnetAnchor(t, first)
	cases := map[string]struct {
		anchor       Anchor
		certificates []string
		message      string
	}{
		"next epoch without its predecessor": {anchor, []string{string(second.raw)}, "current_epoch"},
		"another epoch's signing key":        {Anchor{660, second.fields["aggregate_verification_key"].(string), anchor.ProtocolParametersHash}, []string{string(first.raw)}, "aggregate verification key"},
		"lowered quorum": {anchor, []string{first.mutate(t, func(f map[string]any) {
			f["metadata"].(map[string]any)["parameters"].(map[string]any)["k"] = 1
		})}, "protocol parameters"},
		"altered stake root": {anchor, []string{first.mutate(t, func(f map[string]any) {
			f["protocol_message"].(map[string]any)["message_parts"].(map[string]any)["cardano_stake_distribution_merkle_root"] = string(bytes.Repeat([]byte("0"), 64))
		})}, "signed message"},
		"re-signed message": {anchor, []string{first.mutate(t, func(f map[string]any) {
			parts := f["protocol_message"].(map[string]any)["message_parts"].(map[string]any)
			parts["cardano_stake_distribution_merkle_root"] = string(bytes.Repeat([]byte("0"), 64))
			digest, err := messageDigest(stringParts(parts))
			require.NoError(t, err)
			f["signed_message"] = digest
		})}, "multi-signature"},
		"unknown message part": {anchor, []string{first.mutate(t, func(f map[string]any) {
			f["protocol_message"].(map[string]any)["message_parts"].(map[string]any)["future_part"] = "x"
		})}, "unknown message part"},
		"genesis signature":         {anchor, []string{first.mutate(t, func(f map[string]any) { f["genesis_signature"] = "00" })}, "genesis"},
		"malformed multi-signature": {anchor, []string{first.mutate(t, func(f map[string]any) { f["multi_signature"] = "7b7d" })}, "multi-signature"},
		"not JSON":                  {anchor, []string{"{"}, "invalid Mithril certificate"},
		"no certificates":           {anchor, nil, "no certificates"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, _, err := VerifyCertificates(tc.anchor, tc.certificates)
			require.ErrorIs(t, err, ErrInvalidCertificate)
			require.ErrorContains(t, err, tc.message)
		})
	}
}

func stringParts(parts map[string]any) map[string]string {
	result := make(map[string]string, len(parts))
	for key, value := range parts {
		result[key] = value.(string)
	}
	return result
}
