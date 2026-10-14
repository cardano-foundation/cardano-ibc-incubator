package probabilistic

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
	"time"

	sdkmath "cosmossdk.io/math"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	minttypes "github.com/cosmos/cosmos-sdk/x/mint/types"
	transfertypes "github.com/cosmos/ibc-go/v8/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
	connectiontypes "github.com/cosmos/ibc-go/v8/modules/core/03-connection/types"
	channeltypes "github.com/cosmos/ibc-go/v8/modules/core/04-channel/types"
	commitmenttypes "github.com/cosmos/ibc-go/v8/modules/core/23-commitment/types"
	"github.com/cosmos/ibc-go/v8/testing/simapp"
	"github.com/fxamacker/cbor/v2"
	"github.com/stretchr/testify/require"

	probabilisticcore "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core"
)

// These tests run ibc-go v8.7.0's channel-upgrade handlers with this client as
// the verifier of a simulated Cardano counterparty. Cardano commits the CBOR
// encodings fixed by tests/ibc-state-commitment/channel-upgrade.json. The old
// client must authenticate every Cardano record of a connection-hop migration,
// because ibc-go verifies each upgrade step through the channel's current
// connection until OPEN.

const (
	upgradePort             = "transfer"
	upgradeLocalChannel     = "channel-0"
	upgradeCardanoChannel   = "channel-7"
	upgradeVersion          = "ics20-1"
	upgradeCardanoLane      = 0
	upgradeCardanoLaneCount = 1
)

// Each local connection is paired with a Cardano connection whose ID differs,
// as it does between Cardano and a Cosmos chain.
var upgradeRoutes = []struct{ local, client, cardano string }{
	{"connection-0", ModuleName + "-0", "connection-3"},
	{"connection-1", ModuleName + "-1", "connection-4"},
	{"connection-2", ModuleName + "-2", "connection-5"},
}

// cardanoChannelEnd is the simulated Cardano end of the channel.
type cardanoChannelEnd struct {
	state    channeltypes.State
	hop      string
	sequence uint64
	// Deployments without upgrade support commit five-field channel ends.
	legacy bool
}

type cardanoUpgrade struct {
	hop              string
	timeout          uint64
	nextSequenceSend uint64
}

type upgradeHarness struct {
	t       *testing.T
	app     *simapp.SimApp
	ctx     sdk.Context
	relayer string
	user    sdk.AccAddress

	height  uint64
	channel cardanoChannelEnd
	upgrade *cardanoUpgrade
	receipt *channeltypes.ErrorReceipt
	lane    map[string][]byte
}

// cardanoCommit is the Cardano state authenticated at one client height.
type cardanoCommit struct {
	height clienttypes.Height
	host   map[string][]byte
	lane   map[string][]byte
}

func newUpgradeHarness(t *testing.T) *upgradeHarness {
	t.Helper()
	app := simapp.Setup(t, false)
	t.Cleanup(func() { require.NoError(t, app.Close()) })
	RegisterInterfaces(app.InterfaceRegistry())
	ctx := app.NewContextLegacy(false, cmtproto.Header{ChainID: "injective-1", Height: 100, Time: time.Unix(1_700_000_100, 0)})
	params := app.IBCKeeper.ClientKeeper.GetParams(ctx)
	params.AllowedClients = append(params.AllowedClients, ModuleName)
	app.IBCKeeper.ClientKeeper.SetParams(ctx, params)
	h := &upgradeHarness{
		t: t, app: app, ctx: ctx, height: 10, lane: map[string][]byte{},
		relayer: sdk.AccAddress(bytes.Repeat([]byte{7}, 20)).String(),
		user:    sdk.AccAddress(bytes.Repeat([]byte{8}, 20)),
	}
	for _, route := range upgradeRoutes {
		h.installClient(route.client)
		app.IBCKeeper.ConnectionKeeper.SetConnection(ctx, route.local, connectiontypes.ConnectionEnd{
			ClientId: route.client, Versions: []*connectiontypes.Version{connectiontypes.DefaultIBCVersion}, State: connectiontypes.OPEN,
			Counterparty: connectiontypes.Counterparty{ClientId: "07-tendermint-2", ConnectionId: route.cardano, Prefix: commitmenttypes.NewMerklePrefix([]byte("ibc"))},
		})
	}
	coins := sdk.NewCoins(sdk.NewCoin(sdk.DefaultBondDenom, sdkmath.NewInt(10_000)))
	require.NoError(t, app.BankKeeper.MintCoins(ctx, minttypes.ModuleName, coins))
	require.NoError(t, app.BankKeeper.SendCoinsFromModuleToAccount(ctx, minttypes.ModuleName, h.user, coins))
	h.openChannel()
	return h
}

func (h *upgradeHarness) installClient(id string) {
	h.t.Helper()
	cdc := h.app.AppCodec()
	store := h.app.IBCKeeper.ClientKeeper.ClientStore(h.ctx, id)
	state := newProbabilisticTestClientState()
	setTestCheckpoint(h.t, state, state.LatestHeight, testBlockHash("checkpoint-"+id), 7, state.LatestHeight.RevisionHeight)
	state.OperationalCertificateCounterHistoryStartHeight = state.LatestHeight
	state.EpochContextChallenges = []*EpochContextChallenge{{Epoch: 7, UsableAfterUnixNs: uint64(h.ctx.BlockTime().UnixNano())}}
	require.NoError(h.t, state.Validate())
	setClientState(store, cdc, state)
	consensus := newProbabilisticTestConsensusState(state.LatestCheckpointBlockHash, state.LatestHeight.RevisionHeight)
	consensus.Timestamp = state.LatestCheckpointTimestamp
	setTestPacketSnapshot(h.t, consensus, state.LatestHeight.RevisionHeight)
	setConsensusState(store, cdc, consensus, state.LatestHeight)
	setConsensusMetadataWithValues(store, state.LatestHeight, clienttypes.NewHeight(1, 99), uint64(h.ctx.BlockTime().UnixNano()))
}

func plutusRecord(fields ...any) cbor.Tag { return cbor.Tag{Number: 121, Content: fields} }

func plutusConstructor(index uint64) cbor.Tag {
	return cbor.Tag{Number: 121 + index, Content: []any{}}
}

func (h *upgradeHarness) encode(value any) []byte {
	h.t.Helper()
	encoded, err := cbor.Marshal(value)
	require.NoError(h.t, err)
	return encoded
}

func (h *upgradeHarness) hostValues() map[string][]byte {
	channel := []any{
		plutusConstructor(uint64(h.channel.state)), plutusConstructor(uint64(channeltypes.UNORDERED)),
		plutusRecord([]byte(upgradePort), []byte(upgradeLocalChannel)),
		[][]byte{[]byte(h.channel.hop)}, []byte(upgradeVersion),
	}
	if !h.channel.legacy {
		channel = append(channel, h.channel.sequence)
	}
	values := map[string][]byte{
		"channelEnds/ports/transfer/channels/" + upgradeCardanoChannel: h.encode(plutusRecord(channel...)),
	}
	if h.upgrade != nil {
		values["channelUpgrades/upgrades/ports/transfer/channels/"+upgradeCardanoChannel] = h.encode(plutusRecord(
			plutusRecord(plutusConstructor(uint64(channeltypes.UNORDERED)), [][]byte{[]byte(h.upgrade.hop)}, []byte(upgradeVersion)),
			plutusRecord(plutusRecord(uint64(0), uint64(0)), h.upgrade.timeout),
			h.upgrade.nextSequenceSend,
		))
	}
	if h.receipt != nil {
		values["channelUpgrades/upgradeError/ports/transfer/channels/"+upgradeCardanoChannel] = h.encode(plutusRecord(h.receipt.Sequence, []byte(h.receipt.Message)))
	}
	return values
}

// commit authenticates the current Cardano state for the given clients at a
// new Cardano height with the given block timestamp.
func (h *upgradeHarness) commit(timestamp time.Time, clients ...string) cardanoCommit {
	h.t.Helper()
	h.height++
	commit := cardanoCommit{height: clienttypes.NewHeight(0, h.height), host: h.hostValues(), lane: map[string][]byte{}}
	for key, value := range h.lane {
		commit.lane[key] = value
	}
	// An empty lane still has an authenticated root.
	laneValues := commit.lane
	if len(laneValues) == 0 {
		laneValues = map[string][]byte{"commitments/ports/transfer/channels/" + upgradeCardanoChannel + "/sequences/0": {1}}
	}
	_, hostRoot := acceptanceProof(h.t, commit.host, "channelEnds/ports/transfer/channels/"+upgradeCardanoChannel)
	var laneRoot []byte
	for key := range laneValues {
		_, laneRoot = acceptanceProof(h.t, laneValues, key)
		break
	}
	name, err := probabilisticcore.PacketLaneTokenName(upgradePort, upgradeCardanoChannel, upgradeCardanoLane, upgradeCardanoLaneCount)
	require.NoError(h.t, err)
	blockHash := testBlockHash(fmt.Sprintf("cardano-%d", h.height))
	snapshot, err := probabilisticcore.EncodePacketStateSnapshot(probabilisticcore.PacketStateSnapshot{
		Height: h.height, BlockHash: blockHash, HostTxHash: fmt.Sprintf("%064x", 2*h.height), HostRoot: hostRoot,
		Lanes: map[string]probabilisticcore.TrackedPacketLane{hex.EncodeToString(name): {
			State: probabilisticcore.PacketLaneRoot{
				Height: h.height, Port: upgradePort, Channel: upgradeCardanoChannel, Lane: upgradeCardanoLane,
				LaneCount: upgradeCardanoLaneCount, Version: h.height, Root: laneRoot,
			},
			TxHash: fmt.Sprintf("%064x", 2*h.height+1), OutputIndex: 1,
		}},
	})
	require.NoError(h.t, err)
	cdc := h.app.AppCodec()
	for _, client := range clients {
		store := h.app.IBCKeeper.ClientKeeper.ClientStore(h.ctx, client)
		consensus := newProbabilisticTestConsensusState(blockHash, h.height)
		consensus.Timestamp = uint64(timestamp.UnixNano())
		consensus.IbcStateRoot = hostRoot
		consensus.PacketStateSnapshot = snapshot
		height := NewHeight(0, h.height)
		setConsensusState(store, cdc, consensus, height)
		setConsensusMetadataWithValues(store, height, clienttypes.NewHeight(1, uint64(h.ctx.BlockHeight())), uint64(h.ctx.BlockTime().UnixNano()))
	}
	return commit
}

func (commit cardanoCommit) hostProof(t *testing.T, key string) []byte {
	t.Helper()
	require.NotEmpty(t, commit.host[key], "Cardano did not commit %s", key)
	proof, _ := acceptanceProof(t, commit.host, key)
	return proof
}

func (commit cardanoCommit) channelProof(t *testing.T) []byte {
	return commit.hostProof(t, "channelEnds/ports/transfer/channels/"+upgradeCardanoChannel)
}

func (commit cardanoCommit) upgradeProof(t *testing.T) []byte {
	return commit.hostProof(t, "channelUpgrades/upgrades/ports/transfer/channels/"+upgradeCardanoChannel)
}

func (commit cardanoCommit) receiptProof(t *testing.T) []byte {
	return commit.hostProof(t, "channelUpgrades/upgradeError/ports/transfer/channels/"+upgradeCardanoChannel)
}

func (commit cardanoCommit) laneProof(t *testing.T, key string) []byte {
	t.Helper()
	require.NotEmpty(t, commit.lane[key], "Cardano did not commit %s", key)
	proof, _ := acceptanceProof(t, commit.lane, key)
	return proof
}

func (h *upgradeHarness) localChannel() channeltypes.Channel {
	h.t.Helper()
	channel, found := h.app.IBCKeeper.ChannelKeeper.GetChannel(h.ctx, upgradePort, upgradeLocalChannel)
	require.True(h.t, found)
	return channel
}

func (h *upgradeHarness) localUpgrade() channeltypes.Upgrade {
	h.t.Helper()
	upgrade, found := h.app.IBCKeeper.ChannelKeeper.GetUpgrade(h.ctx, upgradePort, upgradeLocalChannel)
	require.True(h.t, found)
	return upgrade
}

// openChannel runs the local opening handshake against a Cardano deployment
// that predates channel upgrades and commits five-field channel ends.
func (h *upgradeHarness) openChannel() {
	h.t.Helper()
	_, err := h.app.IBCKeeper.ChannelOpenInit(h.ctx, channeltypes.NewMsgChannelOpenInit(
		upgradePort, upgradeVersion, channeltypes.UNORDERED, []string{upgradeRoutes[0].local}, upgradePort, h.relayer,
	))
	require.NoError(h.t, err)
	h.channel = cardanoChannelEnd{state: channeltypes.TRYOPEN, hop: upgradeRoutes[0].cardano, legacy: true}
	commit := h.commit(h.ctx.BlockTime(), upgradeRoutes[0].client)
	_, err = h.app.IBCKeeper.ChannelOpenAck(h.ctx, channeltypes.NewMsgChannelOpenAck(
		upgradePort, upgradeLocalChannel, upgradeCardanoChannel, upgradeVersion, commit.channelProof(h.t), commit.height, h.relayer,
	))
	require.NoError(h.t, err)
	require.Equal(h.t, channeltypes.OPEN, h.localChannel().State)
	h.channel.state = channeltypes.OPEN
}

// cardanoInit is the authorized Cardano upgrade proposal. Cardano also starts
// committing its upgrade sequence from this point.
func (h *upgradeHarness) cardanoInit(route int) {
	h.channel.legacy = false
	h.channel.sequence++
	h.upgrade = &cardanoUpgrade{hop: upgradeRoutes[route].cardano}
}

// cardanoFlush starts flushing on Cardano, as its TRY or ACK would.
func (h *upgradeHarness) cardanoFlush(timeout time.Time, nextSequenceSend uint64) {
	h.channel.state = channeltypes.FLUSHING
	h.upgrade.timeout = uint64(timeout.UnixNano())
	h.upgrade.nextSequenceSend = nextSequenceSend
}

func (h *upgradeHarness) cardanoOpen() {
	h.channel.state = channeltypes.OPEN
	h.channel.hop = h.upgrade.hop
	h.upgrade = nil
}

func (h *upgradeHarness) cardanoUpgradeValue() channeltypes.Upgrade {
	return channeltypes.Upgrade{
		Fields:           channeltypes.NewUpgradeFields(channeltypes.UNORDERED, []string{h.upgrade.hop}, upgradeVersion),
		Timeout:          channeltypes.NewTimeout(clienttypes.ZeroHeight(), h.upgrade.timeout),
		NextSequenceSend: h.upgrade.nextSequenceSend,
	}
}

func (h *upgradeHarness) advance(duration time.Duration) {
	h.ctx = h.ctx.WithBlockTime(h.ctx.BlockTime().Add(duration)).WithBlockHeight(h.ctx.BlockHeight() + 1)
}

func cardanoPacket(sequence uint64, denom, amount, receiver string) channeltypes.Packet {
	data := transfertypes.NewFungibleTokenPacketData(denom, amount, "cardano-sender", receiver, "").GetBytes()
	return channeltypes.NewPacket(data, sequence, upgradePort, upgradeCardanoChannel, upgradePort, upgradeLocalChannel,
		clienttypes.ZeroHeight(), uint64(time.Date(2090, 1, 1, 0, 0, 0, 0, time.UTC).UnixNano()))
}

func (h *upgradeHarness) sendFromCardano(packet channeltypes.Packet) {
	h.lane[fmt.Sprintf("commitments/ports/transfer/channels/%s/sequences/%d", upgradeCardanoChannel, packet.Sequence)] = channeltypes.CommitPacket(nil, packet)
}

func (h *upgradeHarness) recvOnCardano(packet channeltypes.Packet, ack []byte) {
	h.lane[fmt.Sprintf("acks/ports/transfer/channels/%s/sequences/%d", upgradeCardanoChannel, packet.Sequence)] = channeltypes.CommitAcknowledgement(ack)
}

func (h *upgradeHarness) recvLocally(commit cardanoCommit, packet channeltypes.Packet) error {
	key := fmt.Sprintf("commitments/ports/transfer/channels/%s/sequences/%d", upgradeCardanoChannel, packet.Sequence)
	proof := []byte{}
	if commit.lane[key] != nil {
		proof = commit.laneProof(h.t, key)
	} else {
		proof, _ = acceptanceProof(h.t, map[string][]byte{key: channeltypes.CommitPacket(nil, packet)}, key)
	}
	response, err := h.app.IBCKeeper.RecvPacket(h.ctx, channeltypes.NewMsgRecvPacket(packet, proof, commit.height, h.relayer))
	if err == nil && response.Result != channeltypes.SUCCESS {
		return fmt.Errorf("receive result %s", response.Result)
	}
	return err
}

func (h *upgradeHarness) ackLocally(commit cardanoCommit, packet channeltypes.Packet, ack []byte) error {
	key := fmt.Sprintf("acks/ports/transfer/channels/%s/sequences/%d", upgradeCardanoChannel, packet.Sequence)
	_, err := h.app.IBCKeeper.Acknowledgement(h.ctx, channeltypes.NewMsgAcknowledgement(packet, ack, commit.laneProof(h.t, key), commit.height, h.relayer))
	return err
}

func (h *upgradeHarness) sendLocally(coin sdk.Coin) (channeltypes.Packet, error) {
	timeout := uint64(time.Date(2090, 1, 1, 0, 0, 0, 0, time.UTC).UnixNano())
	msg := transfertypes.NewMsgTransfer(upgradePort, upgradeLocalChannel, coin, h.user.String(), "addr_test_cardano_receiver", clienttypes.ZeroHeight(), timeout, "")
	response, err := h.app.TransferKeeper.Transfer(h.ctx, msg)
	if err != nil {
		return channeltypes.Packet{}, err
	}
	denom := coin.Denom
	if strings.HasPrefix(denom, "ibc/") {
		trace, err := h.app.TransferKeeper.DenomPathFromHash(h.ctx, denom)
		require.NoError(h.t, err)
		denom = trace
	}
	data := transfertypes.NewFungibleTokenPacketData(denom, coin.Amount.String(), h.user.String(), "addr_test_cardano_receiver", "").GetBytes()
	return channeltypes.NewPacket(data, response.Sequence, upgradePort, upgradeLocalChannel, upgradePort, upgradeCardanoChannel, clienttypes.ZeroHeight(), timeout), nil
}

func (h *upgradeHarness) try(commit cardanoCommit, route int, sequence uint64) (*channeltypes.MsgChannelUpgradeTryResponse, error) {
	return h.app.IBCKeeper.ChannelUpgradeTry(h.ctx, channeltypes.NewMsgChannelUpgradeTry(
		upgradePort, upgradeLocalChannel, []string{upgradeRoutes[route].local},
		channeltypes.NewUpgradeFields(channeltypes.UNORDERED, []string{upgradeRoutes[route].cardano}, upgradeVersion), sequence,
		commit.channelProof(h.t), commit.upgradeProof(h.t), commit.height, h.relayer,
	))
}

func (h *upgradeHarness) localInit(route int) {
	h.t.Helper()
	_, err := h.app.IBCKeeper.ChannelUpgradeInit(h.ctx, channeltypes.NewMsgChannelUpgradeInit(
		upgradePort, upgradeLocalChannel, channeltypes.NewUpgradeFields(channeltypes.UNORDERED, []string{upgradeRoutes[route].local}, upgradeVersion),
		h.app.IBCKeeper.GetAuthority(),
	))
	require.NoError(h.t, err)
}

func (h *upgradeHarness) ack(commit cardanoCommit, upgrade channeltypes.Upgrade) (*channeltypes.MsgChannelUpgradeAckResponse, error) {
	return h.app.IBCKeeper.ChannelUpgradeAck(h.ctx, channeltypes.NewMsgChannelUpgradeAck(
		upgradePort, upgradeLocalChannel, upgrade, commit.channelProof(h.t), commit.upgradeProof(h.t), commit.height, h.relayer,
	))
}

func (h *upgradeHarness) confirm(commit cardanoCommit, state channeltypes.State, upgrade channeltypes.Upgrade) (*channeltypes.MsgChannelUpgradeConfirmResponse, error) {
	return h.app.IBCKeeper.ChannelUpgradeConfirm(h.ctx, channeltypes.NewMsgChannelUpgradeConfirm(
		upgradePort, upgradeLocalChannel, state, upgrade, commit.channelProof(h.t), commit.upgradeProof(h.t), commit.height, h.relayer,
	))
}

func (h *upgradeHarness) open(commit cardanoCommit, state channeltypes.State, sequence uint64) error {
	_, err := h.app.IBCKeeper.ChannelUpgradeOpen(h.ctx, channeltypes.NewMsgChannelUpgradeOpen(
		upgradePort, upgradeLocalChannel, state, sequence, commit.channelProof(h.t), commit.height, h.relayer,
	))
	return err
}

// The Cardano channel as ibc-go expects it in TIMEOUT, which takes the whole
// counterparty channel from the relayer.
func (h *upgradeHarness) cardanoChannelValue() channeltypes.Channel {
	return channeltypes.Channel{
		State: h.channel.state, Ordering: channeltypes.UNORDERED,
		Counterparty:   channeltypes.NewCounterparty(upgradePort, upgradeLocalChannel),
		ConnectionHops: []string{h.channel.hop}, Version: upgradeVersion, UpgradeSequence: h.channel.sequence,
	}
}

var successAck = channeltypes.NewResultAcknowledgement([]byte{1}).Acknowledgement()

// Cardano proposes the migration and the local chain is the TRY side. In-flight
// packets in both directions finish through the old client before OPEN, and
// assets issued before the cutover remain redeemable through the same channel.
func TestChannelUpgradeCardanoInitiatedMigration(t *testing.T) {
	h := newUpgradeHarness(t)
	oldClient, newClient := upgradeRoutes[0].client, upgradeRoutes[1].client
	escrow := transfertypes.GetEscrowAddress(upgradePort, upgradeLocalChannel)
	voucher := transfertypes.ParseDenomTrace(upgradePort + "/" + upgradeLocalChannel + "/lovelace").IBCDenom()

	// Before the upgrade: Cardano sends lovelace, and the local chain escrows stake.
	inbound := cardanoPacket(1, "lovelace", "100", h.user.String())
	h.sendFromCardano(inbound)
	commit := h.commit(h.ctx.BlockTime(), oldClient)
	require.NoError(t, h.recvLocally(commit, inbound))
	require.Equal(t, sdkmath.NewInt(100), h.app.BankKeeper.GetBalance(h.ctx, h.user, voucher).Amount)
	outbound, err := h.sendLocally(sdk.NewInt64Coin(sdk.DefaultBondDenom, 1_000))
	require.NoError(t, err)
	require.Equal(t, sdkmath.NewInt(1_000), h.app.BankKeeper.GetBalance(h.ctx, escrow, sdk.DefaultBondDenom).Amount)

	// Cardano receives the outbound packet and sends a second packet. Neither
	// side has settled these packets when the upgrade starts.
	h.recvOnCardano(outbound, successAck)
	inFlight := cardanoPacket(2, "lovelace", "50", h.user.String())
	h.sendFromCardano(inFlight)

	// Cardano INIT. The local TRY proves Cardano's channel and INIT-stage upgrade
	// through the old client.
	h.cardanoInit(1)
	commit = h.commit(h.ctx.BlockTime(), oldClient)
	response, err := h.try(commit, 1, 1)
	require.NoError(t, err)
	require.Equal(t, channeltypes.SUCCESS, response.Result)
	require.Equal(t, channeltypes.FLUSHING, h.localChannel().State)
	require.Equal(t, uint64(1), h.localChannel().UpgradeSequence)
	// A failed transfer in a real transaction reverts its escrow as well.
	attempt := *h
	attempt.ctx, _ = h.ctx.CacheContext()
	_, err = attempt.sendLocally(sdk.NewInt64Coin(sdk.DefaultBondDenom, 1))
	require.ErrorIs(t, err, channeltypes.ErrInvalidChannelState, "flushing must stop new sends")

	// Cardano ACK starts its flush with the in-flight packet below its boundary.
	h.cardanoFlush(h.ctx.BlockTime().Add(time.Hour), 3)
	commit = h.commit(h.ctx.BlockTime(), oldClient)
	// The relayer cannot claim FLUSHCOMPLETE or alter Cardano's upgrade record.
	_, err = h.confirm(commit, channeltypes.FLUSHCOMPLETE, h.cardanoUpgradeValue())
	require.Error(t, err)
	altered := h.cardanoUpgradeValue()
	altered.NextSequenceSend = 4
	_, err = h.confirm(commit, channeltypes.FLUSHING, altered)
	require.Error(t, err)
	confirm, err := h.confirm(commit, channeltypes.FLUSHING, h.cardanoUpgradeValue())
	require.NoError(t, err)
	require.Equal(t, channeltypes.SUCCESS, confirm.Result)
	require.Equal(t, channeltypes.FLUSHING, h.localChannel().State)

	// Packets at or after Cardano's send boundary are rejected. The in-flight
	// packets in both directions settle through the old client.
	h.sendFromCardano(cardanoPacket(3, "lovelace", "1", h.user.String()))
	commit = h.commit(h.ctx.BlockTime(), oldClient)
	require.ErrorIs(t, h.recvLocally(commit, cardanoPacket(3, "lovelace", "1", h.user.String())), channeltypes.ErrInvalidPacket)
	delete(h.lane, "commitments/ports/transfer/channels/channel-7/sequences/3")
	require.NoError(t, h.recvLocally(commit, inFlight))
	require.NoError(t, h.ackLocally(commit, outbound, successAck))
	require.Equal(t, channeltypes.FLUSHCOMPLETE, h.localChannel().State)

	// Cardano settles the local acknowledgement and completes its flush. OPEN
	// proves Cardano's FLUSHCOMPLETE channel through the old client.
	delete(h.lane, "commitments/ports/transfer/channels/channel-7/sequences/1")
	delete(h.lane, "commitments/ports/transfer/channels/channel-7/sequences/2")
	h.channel.state = channeltypes.FLUSHCOMPLETE
	commit = h.commit(h.ctx.BlockTime(), oldClient)
	require.Error(t, h.open(commit, channeltypes.OPEN, 1), "Cardano has not opened")
	require.NoError(t, h.open(commit, channeltypes.FLUSHCOMPLETE, 1))
	channel := h.localChannel()
	require.Equal(t, channeltypes.OPEN, channel.State)
	require.Equal(t, []string{upgradeRoutes[1].local}, channel.ConnectionHops)
	require.Equal(t, uint64(1), channel.UpgradeSequence)
	h.cardanoOpen()

	// After the cutover the same channel ID carries the old vouchers and escrow.
	// New Cardano state is only known to the replacement client.
	back, err := h.sendLocally(sdk.NewInt64Coin(voucher, 150))
	require.NoError(t, err)
	require.Equal(t, uint64(2), back.Sequence, "sequences continue across the upgrade")
	require.True(t, h.app.BankKeeper.GetBalance(h.ctx, h.user, voucher).Amount.IsZero())
	returned := cardanoPacket(3, "transfer/"+upgradeCardanoChannel+"/"+sdk.DefaultBondDenom, "1000", h.user.String())
	h.sendFromCardano(returned)
	commit = h.commit(h.ctx.BlockTime(), newClient)
	before := h.app.BankKeeper.GetBalance(h.ctx, h.user, sdk.DefaultBondDenom).Amount
	require.NoError(t, h.recvLocally(commit, returned))
	require.Equal(t, before.AddRaw(1_000), h.app.BankKeeper.GetBalance(h.ctx, h.user, sdk.DefaultBondDenom).Amount)
	require.True(t, h.app.BankKeeper.GetBalance(h.ctx, escrow, sdk.DefaultBondDenom).Amount.IsZero())
	require.True(t, h.app.TransferKeeper.GetTotalEscrowForDenom(h.ctx, sdk.DefaultBondDenom).Amount.IsZero())

	// A packet received before the upgrade cannot be replayed through the new
	// route, even with a valid proof from the replacement client.
	h.sendFromCardano(inFlight)
	commit = h.commit(h.ctx.BlockTime(), newClient)
	require.Error(t, h.recvLocally(commit, inFlight))
	require.True(t, h.app.BankKeeper.GetBalance(h.ctx, h.user, voucher).Amount.IsZero())
}

// The local chain proposes the migration and Cardano is the TRY side. Cardano
// then opens first, so the local OPEN proves Cardano's upgraded channel
// through the old client.
func TestChannelUpgradeLocallyInitiatedMigration(t *testing.T) {
	h := newUpgradeHarness(t)
	oldClient := upgradeRoutes[0].client
	h.localInit(1)
	require.Equal(t, channeltypes.OPEN, h.localChannel().State)
	require.Equal(t, uint64(1), h.localChannel().UpgradeSequence)

	h.cardanoInit(1)
	h.cardanoFlush(h.ctx.BlockTime().Add(time.Hour), 1)
	commit := h.commit(h.ctx.BlockTime(), oldClient)
	response, err := h.ack(commit, h.cardanoUpgradeValue())
	require.NoError(t, err)
	require.Equal(t, channeltypes.SUCCESS, response.Result)
	require.Equal(t, channeltypes.FLUSHCOMPLETE, h.localChannel().State)

	h.channel.state = channeltypes.FLUSHCOMPLETE
	h.cardanoOpen()
	commit = h.commit(h.ctx.BlockTime(), oldClient)
	// OPEN derives Cardano's expected hop from the counterparty of the local
	// replacement connection. The old hop and a different sequence are rejected.
	h.channel.hop = upgradeRoutes[0].cardano
	stale := h.commit(h.ctx.BlockTime(), oldClient)
	require.Error(t, h.open(stale, channeltypes.OPEN, 1))
	h.channel.hop = upgradeRoutes[1].cardano
	require.Error(t, h.open(commit, channeltypes.OPEN, 2))
	require.NoError(t, h.open(commit, channeltypes.OPEN, 1))
	require.Equal(t, []string{upgradeRoutes[1].local}, h.localChannel().ConnectionHops)
}

// A Cardano deployment without upgrade support commits five-field channel
// ends. Such a channel end only proves sequence zero, so it cannot satisfy TRY
// or ACK for sequence one even when every other record matches.
func TestChannelUpgradeRejectsLegacyCardanoChannel(t *testing.T) {
	h := newUpgradeHarness(t)
	h.upgrade = &cardanoUpgrade{hop: upgradeRoutes[1].cardano}
	commit := h.commit(h.ctx.BlockTime(), upgradeRoutes[0].client)
	_, err := h.try(commit, 1, 1)
	require.ErrorContains(t, err, "UpgradeSequence mismatch")
	require.Equal(t, channeltypes.OPEN, h.localChannel().State)

	h.localInit(1)
	h.channel.state = channeltypes.FLUSHING
	h.upgrade.timeout, h.upgrade.nextSequenceSend = uint64(h.ctx.BlockTime().Add(time.Hour).UnixNano()), 1
	commit = h.commit(h.ctx.BlockTime(), upgradeRoutes[0].client)
	_, err = h.ack(commit, h.cardanoUpgradeValue())
	require.ErrorContains(t, err, "UpgradeSequence mismatch")
	require.Equal(t, channeltypes.OPEN, h.localChannel().State)
}

// Cardano rejects the proposal and commits an error receipt. The local chain
// cancels with a proof of that receipt.
func TestChannelUpgradeCancelWithCardanoErrorReceipt(t *testing.T) {
	h := newUpgradeHarness(t)
	h.localInit(1)
	h.channel.legacy = false
	h.channel.sequence = 1
	h.receipt = &channeltypes.ErrorReceipt{Sequence: 1, Message: "ABCI code: 31: restored channel to pre-upgrade state"}
	commit := h.commit(h.ctx.BlockTime(), upgradeRoutes[0].client)
	cancel := func(receipt channeltypes.ErrorReceipt) error {
		_, err := h.app.IBCKeeper.ChannelUpgradeCancel(h.ctx, channeltypes.NewMsgChannelUpgradeCancel(
			upgradePort, upgradeLocalChannel, receipt, commit.receiptProof(t), commit.height, h.relayer,
		))
		return err
	}
	require.Error(t, cancel(channeltypes.ErrorReceipt{Sequence: 1, Message: "different"}))
	require.Error(t, cancel(channeltypes.ErrorReceipt{Sequence: 2, Message: h.receipt.Message}))
	require.NoError(t, cancel(*h.receipt))
	require.Equal(t, channeltypes.OPEN, h.localChannel().State)
	require.Equal(t, []string{upgradeRoutes[0].local}, h.localChannel().ConnectionHops)
	_, found := h.app.IBCKeeper.ChannelKeeper.GetUpgrade(h.ctx, upgradePort, upgradeLocalChannel)
	require.False(t, found)
}

// Cardano stalls while flushing. After the local timeout passes on Cardano's
// clock, the local chain restores the channel with a proof of Cardano's state.
func TestChannelUpgradeTimeoutWithCardanoProof(t *testing.T) {
	h := newUpgradeHarness(t)
	oldClient := upgradeRoutes[0].client
	h.localInit(1)
	h.cardanoInit(1)
	h.cardanoFlush(h.ctx.BlockTime().Add(time.Hour), 1)
	commit := h.commit(h.ctx.BlockTime(), oldClient)
	_, err := h.ack(commit, h.cardanoUpgradeValue())
	require.NoError(t, err)
	timeout := time.Unix(0, int64(h.localUpgrade().Timeout.Timestamp))

	timeoutWith := func(commit cardanoCommit, channel channeltypes.Channel) error {
		_, err := h.app.IBCKeeper.ChannelUpgradeTimeout(h.ctx, channeltypes.NewMsgChannelUpgradeTimeout(
			upgradePort, upgradeLocalChannel, channel, commit.channelProof(t), commit.height, h.relayer,
		))
		return err
	}
	early := h.commit(timeout.Add(-time.Second), oldClient)
	require.ErrorIs(t, timeoutWith(early, h.cardanoChannelValue()), channeltypes.ErrTimeoutNotReached)
	h.advance(time.Hour)
	late := h.commit(timeout, oldClient)
	claimed := h.cardanoChannelValue()
	claimed.UpgradeSequence = 2
	require.Error(t, timeoutWith(late, claimed), "the relayer-supplied channel must match the commitment")
	require.NoError(t, timeoutWith(late, h.cardanoChannelValue()))
	require.Equal(t, channeltypes.OPEN, h.localChannel().State)
	require.Equal(t, []string{upgradeRoutes[0].local}, h.localChannel().ConnectionHops)
}

// ibc-go v8.7.0 decides that a counterparty already upgraded by comparing the
// local replacement connection ID with the counterparty's ID for that
// connection. Those IDs differ between Cardano and the local chain, so a
// FLUSHCOMPLETE local end can still time out after Cardano opened with the new
// connection. Cardano must therefore not open before the local end.
func TestChannelUpgradeTimeoutAfterCardanoOpenedIsAccepted(t *testing.T) {
	h := newUpgradeHarness(t)
	oldClient := upgradeRoutes[0].client
	h.localInit(1)
	h.cardanoInit(1)
	h.cardanoFlush(h.ctx.BlockTime().Add(time.Hour), 1)
	commit := h.commit(h.ctx.BlockTime(), oldClient)
	_, err := h.ack(commit, h.cardanoUpgradeValue())
	require.NoError(t, err)
	require.Equal(t, channeltypes.FLUSHCOMPLETE, h.localChannel().State)
	timeout := time.Unix(0, int64(h.localUpgrade().Timeout.Timestamp))

	h.cardanoOpen()
	h.advance(time.Hour)
	commit = h.commit(timeout, oldClient)
	_, err = h.app.IBCKeeper.ChannelUpgradeTimeout(h.ctx, channeltypes.NewMsgChannelUpgradeTimeout(
		upgradePort, upgradeLocalChannel, h.cardanoChannelValue(), commit.channelProof(t), commit.height, h.relayer,
	))
	require.NoError(t, err)
	require.Equal(t, []string{upgradeRoutes[0].local}, h.localChannel().ConnectionHops)
	require.Equal(t, upgradeRoutes[1].cardano, h.channel.hop, "the channel ends now use different connections")
}

// A second migration uses the first replacement as its old route and carries
// the nonzero upgrade sequence forward.
func TestChannelUpgradeRepeatedMigration(t *testing.T) {
	h := newUpgradeHarness(t)
	for route := 1; route <= 2; route++ {
		previous := upgradeRoutes[route-1].client
		h.localInit(route)
		h.cardanoInit(route)
		h.cardanoFlush(h.ctx.BlockTime().Add(time.Hour), 1)
		commit := h.commit(h.ctx.BlockTime(), previous)
		_, err := h.ack(commit, h.cardanoUpgradeValue())
		require.NoError(t, err)
		h.channel.state = channeltypes.FLUSHCOMPLETE
		commit = h.commit(h.ctx.BlockTime(), previous)
		require.NoError(t, h.open(commit, channeltypes.FLUSHCOMPLETE, uint64(route)))
		h.cardanoOpen()
		channel := h.localChannel()
		require.Equal(t, []string{upgradeRoutes[route].local}, channel.ConnectionHops)
		require.Equal(t, uint64(route), channel.UpgradeSequence)
	}
	// A Cardano channel still at the previous sequence cannot satisfy an ACK
	// for the next local attempt.
	h.localInit(0)
	h.upgrade = &cardanoUpgrade{hop: upgradeRoutes[0].cardano}
	h.cardanoFlush(h.ctx.BlockTime().Add(time.Hour), 1)
	commit := h.commit(h.ctx.BlockTime(), upgradeRoutes[2].client)
	_, err := h.ack(commit, h.cardanoUpgradeValue())
	require.ErrorContains(t, err, "UpgradeSequence mismatch")
}
