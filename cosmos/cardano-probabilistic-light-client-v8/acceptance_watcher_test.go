package probabilistic

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"testing"
	"time"

	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	"github.com/stretchr/testify/require"
)

type acceptanceWatcherConfig struct {
	Host                    acceptanceHostConfig
	Client, Witness, Cursor string
	Challenge               bool
	WaitAfterHeight         int64
}
type acceptanceWatcherCursor struct {
	LastHeight                                         int64
	ProposalHash, ChallengeHash, HistoricalContextHash string
	ProposalCommittedUnixNs, ChallengeCommittedUnixNs  uint64
	TrustedHeight                                      uint64
}

// This fixture watcher has no access to the host's objects or database files.
// It discovers signed messages and historical snapshots through RPC after
// inclusion. Native verification and freezing happen only in the destination.
func TestCaribicAcceptanceWatcher(t *testing.T) {
	file := os.Getenv("CARIBIC_ACCEPTANCE_WATCHER")
	if file == "" {
		t.Skip("launched by Caribic acceptance driver")
	}
	var config acceptanceWatcherConfig
	acceptanceReadJSON(t, file, &config)
	d := newAcceptanceDriver(t, config.Host, "watcher")
	var cursor acceptanceWatcherCursor
	if _, err := os.Stat(config.Cursor); err == nil {
		acceptanceReadJSON(t, config.Cursor, &cursor)
	}
	previousHeight := cursor.LastHeight
	if !config.Challenge {
		require.NotZero(t, previousHeight, "watcher restart must load its saved cursor")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var submitted *ProbabilisticHeader
	require.Eventually(t, func() bool {
		results, err := d.rpc.TxSearch(ctx, fmt.Sprintf("update_client.client_id='%s'", config.Client), false, nil, nil, "desc")
		if err != nil {
			return false
		}
		for _, result := range results.Txs {
			if !config.Challenge && result.Height <= config.WaitAfterHeight {
				continue
			}
			if result.TxResult.Code != 0 {
				continue
			}
			tx, err := d.app.TxConfig().TxDecoder()(result.Tx)
			require.NoError(t, err)
			for _, msg := range tx.GetMsgs() {
				update, ok := msg.(*clienttypes.MsgUpdateClient)
				if !ok || update.ClientId != config.Client {
					continue
				}
				var message exported.ClientMessage
				require.NoError(t, d.app.AppCodec().UnpackAny(update.ClientMessage, &message))
				header, ok := message.(*ProbabilisticHeader)
				if !ok {
					continue
				}
				if config.Challenge && header.NewEpochContext == nil {
					continue
				}
				submitted = header
				cursor.LastHeight = result.Height
				cursor.ProposalHash = hex.EncodeToString(result.Hash)
				cursor.ProposalCommittedUnixNs = d.blockTime(result.Height)
				cursor.TrustedHeight = header.TrustedHeight.RevisionHeight
				return true
			}
		}
		return false
	}, 25*time.Second, 100*time.Millisecond)
	require.NotNil(t, submitted)
	if config.Challenge {
		latest := d.state(config.Client)
		epoch := submitted.NewEpochContext.Epoch
		key := append([]byte("epochChallengeCheckpoint/"), make([]byte, 8)...)
		for i := 0; i < 8; i++ {
			key[len(key)-1-i] = byte(epoch >> uint(i*8))
		}
		raw := d.store("clients/" + config.Client + "/" + string(key))
		require.NotEmpty(t, raw, "watcher must recover the pre-proposal context")
		var historical ClientState
		require.NoError(t, historical.Unmarshal(raw))
		require.Equal(t, submitted.TrustedHeight, historical.LatestCheckpointHeight)
		require.NotNil(t, historical.LatestCheckpointNonceState)
		require.NotNil(t, historical.LatestCheckpointPoolRegistry)
		require.NotNil(t, historical.LatestCheckpointPoolProduction)
		require.NotNil(t, historical.LatestCheckpointSettlementCredit)
		hash := sha256.Sum256(raw)
		cursor.HistoricalContextHash = hex.EncodeToString(hash[:])
		var witness ProbabilisticHeader
		acceptanceReadJSON(t, config.Witness, &witness)
		require.Equal(t, historical.LatestCheckpointHeight, witness.TrustedHeight)
		require.NotEqual(t, submitted.AnchorBlock.Hash, witness.AnchorBlock.Hash)
		evidence := NewMisbehaviour(config.Client, submitted, &witness)
		// Reconstruct the verifier's saved checkpoint using only destination
		// queries. The independent source witness must pass native validation
		// in that historical context before the watcher signs its challenge.
		watcherCtx, watcherStore := newProbabilisticTestClientStore(t, "rpc-watcher-history")
		watcherCtx = watcherCtx.WithBlockTime(time.Now())
		watcherCodec := newProbabilisticTestCodec()
		watcherStore.Set(key, raw)
		packetKey := append([]byte("epochChallengePacketSnapshot/"), key[len(key)-8:]...)
		packet := d.store("clients/" + config.Client + "/" + string(packetKey))
		require.NotEmpty(t, packet)
		watcherStore.Set(packetKey, packet)
		require.NoError(t, latest.VerifyClientMessage(watcherCtx, watcherCodec, watcherStore, evidence))
		require.True(t, latest.CheckForMisbehaviour(watcherCtx, watcherCodec, watcherStore, evidence))
		challenge, err := clienttypes.NewMsgSubmitMisbehaviour(config.Client, evidence, acceptanceAddress("watcher").String())
		require.NoError(t, err)
		committed := d.send(challenge, "")
		require.NotNil(t, committed)
		cursor.ChallengeHash = hex.EncodeToString(committed.Hash)
		cursor.ChallengeCommittedUnixNs = d.blockTime(committed.Height)
		require.Less(t, cursor.ChallengeCommittedUnixNs, acceptanceDeadline(t, latest, epoch))
		require.False(t, d.state(config.Client).FrozenHeight.IsZero())
	} else {
		require.Greater(t, cursor.LastHeight, previousHeight)
		require.True(t, d.state(config.Client).FrozenHeight.IsZero())
	}
	acceptanceWriteJSON(t, config.Cursor, cursor)
}
