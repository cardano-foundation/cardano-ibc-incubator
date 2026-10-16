package state

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type nativeAuthenticationInputs struct {
	ctx      Context
	client   *ClientState
	header   *ProbabilisticHeader
	contexts []*EpochContext
	trusted  *trustedBlockState
}

func loadNativeAuthenticationInputs(t *testing.T) nativeAuthenticationInputs {
	t.Helper()
	fixture := loadNativeSettlementFixture(t)
	ctx, store := newProbabilisticTestClientStore(t, "linkage-first")
	cdc := newProbabilisticTestCodec()
	ctx.Time = time.Unix(0, int64(fixture.Header.DescendantBlocks[len(fixture.Header.DescendantBlocks)-1].Timestamp))
	require.NoError(t, fixture.Client.Initialize(ctx, cdc, store, fixture.Consensus))
	client, found := GetClientState(store, cdc)
	require.True(t, found)
	trusted, err := client.latestTrustedBlockState(store, cdc)
	require.NoError(t, err)
	current, err := client.normalizedEpochContexts()
	require.NoError(t, err)
	contexts, err := mergeEpochContexts(current, fixture.Header.NewEpochContext)
	require.NoError(t, err)
	return nativeAuthenticationInputs{ctx: ctx, client: client, header: fixture.Header, contexts: contexts, trusted: trusted}
}

// withoutNativeVerification returns a client whose native verification fails:
// only operational certificate checks read the KES evolution limit.
func withoutNativeVerification(client *ClientState) *ClientState {
	broken := *client
	broken.MaxKesEvolutions = 0
	return &broken
}

func TestReplayedHeaderMatchesNativeAuthentication(t *testing.T) {
	in := loadNativeAuthenticationInputs(t)
	verified, err := in.client.authenticateHeaderBlocksWithContexts(in.header, in.contexts, in.trusted.operationalCertificateCounters, in.trusted)
	require.NoError(t, err)
	replayed, err := in.client.replayVerifiedHeaderBlocks(in.header, in.contexts, in.trusted.operationalCertificateCounters, in.trusted)
	require.NoError(t, err)
	require.Equal(t, verified, replayed)
}

func TestReplayedHeaderSkipsNativeVerification(t *testing.T) {
	in := loadNativeAuthenticationInputs(t)
	broken := withoutNativeVerification(in.client)
	_, err := broken.authenticateHeaderBlocksWithContexts(in.header, in.contexts, in.trusted.operationalCertificateCounters, in.trusted)
	require.ErrorContains(t, err, "KES evolutions")
	_, err = broken.replayVerifiedHeaderBlocks(in.header, in.contexts, in.trusted.operationalCertificateCounters, in.trusted)
	require.NoError(t, err)
}

func TestLinkageCheckRunsBeforeNativeVerification(t *testing.T) {
	in := loadNativeAuthenticationInputs(t)
	broken := withoutNativeVerification(in.client)
	stop := errors.New("linkage rejected")
	var decoded *authenticatedProbabilisticHeader
	_, err := broken.authenticateHeaderWitnesses(in.header, in.contexts, in.trusted.operationalCertificateCounters, in.trusted, func(view *authenticatedProbabilisticHeader) error {
		decoded = view
		return stop
	}, false)
	require.ErrorIs(t, err, stop)
	require.True(t, strings.EqualFold(in.header.AnchorBlock.Hash, decoded.anchorBlock.hash))
	require.Len(t, decoded.bridgeBlocks, len(in.header.BridgeBlocks))
	require.Len(t, decoded.descendantBlocks, len(in.header.DescendantBlocks))
	for index, block := range decoded.descendantBlocks {
		require.Equal(t, in.header.DescendantBlocks[index].Height.RevisionHeight, block.height)
		require.Equal(t, in.header.DescendantBlocks[index].Timestamp, block.timestamp)
	}
}

func TestVerifierRejectsDisconnectedChainBeforeNativeVerification(t *testing.T) {
	in := loadNativeAuthenticationInputs(t)
	broken := withoutNativeVerification(in.client)
	disconnected := *in.trusted
	disconnected.blockHash = strings.Repeat("00", 32)
	_, err := broken.linkageFirstAuthenticator(in.ctx)(in.header, in.contexts, in.trusted.operationalCertificateCounters, &disconnected)
	require.ErrorContains(t, err, "does not connect to trusted chain")

	// The connected chain passes the linkage checks and reaches native verification.
	_, err = broken.linkageFirstAuthenticator(in.ctx)(in.header, in.contexts, in.trusted.operationalCertificateCounters, in.trusted)
	require.ErrorContains(t, err, "KES evolutions")
}
