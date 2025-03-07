package mithril

import (
	"fmt"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/ibc-go/v7/modules/core/exported"
	ibcexported "github.com/cosmos/ibc-go/v7/modules/core/exported"
	"time"
)

var _ exported.ClientState = (*ClientState)(nil)
var _ exported.ConsensusState = (*ConsensusState)(nil)

func (m *Height) String() string {
	return fmt.Sprintf("RevisionNumber: %v, RevisionHeight", m.GetRevisionNumber(), m.GetRevisionHeight())
}

func (m *ClientState) ClientType() string {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) GetLatestHeight() exported.Height {
	return &Height{
		RevisionNumber: m.LatestHeight.RevisionNumber,
		RevisionHeight: m.LatestHeight.RevisionHeight,
	}
}

func (m *ClientState) Validate() error {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) Status(ctx sdk.Context, clientStore sdk.KVStore, cdc codec.BinaryCodec) exported.Status {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) ExportMetadata(clientStore sdk.KVStore) []exported.GenesisMetadata {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) ZeroCustomFields() exported.ClientState {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) GetTimestampAtHeight(ctx sdk.Context, clientStore sdk.KVStore, cdc codec.BinaryCodec, height exported.Height) (uint64, error) {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) Initialize(ctx sdk.Context, cdc codec.BinaryCodec, clientStore sdk.KVStore, consensusState exported.ConsensusState) error {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) VerifyMembership(ctx sdk.Context, clientStore sdk.KVStore, cdc codec.BinaryCodec, height exported.Height, delayTimePeriod uint64, delayBlockPeriod uint64, proof []byte, path exported.Path, value []byte) error {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) VerifyNonMembership(ctx sdk.Context, clientStore sdk.KVStore, cdc codec.BinaryCodec, height exported.Height, delayTimePeriod uint64, delayBlockPeriod uint64, proof []byte, path exported.Path) error {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) VerifyClientMessage(ctx sdk.Context, cdc codec.BinaryCodec, clientStore sdk.KVStore, clientMsg exported.ClientMessage) error {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) CheckForMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore sdk.KVStore, clientMsg exported.ClientMessage) bool {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) UpdateStateOnMisbehaviour(ctx sdk.Context, cdc codec.BinaryCodec, clientStore sdk.KVStore, clientMsg exported.ClientMessage) {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) UpdateState(ctx sdk.Context, cdc codec.BinaryCodec, clientStore sdk.KVStore, clientMsg exported.ClientMessage) []exported.Height {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) CheckSubstituteAndUpdateState(ctx sdk.Context, cdc codec.BinaryCodec, subjectClientStore, substituteClientStore sdk.KVStore, substituteClient exported.ClientState) error {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) VerifyUpgradeAndUpdateState(ctx sdk.Context, cdc codec.BinaryCodec, store sdk.KVStore, newClient exported.ClientState, newConsState exported.ConsensusState, proofUpgradeClient, proofUpgradeConsState []byte) error {
	//TODO implement me
	panic("implement me")
}

func (m *ConsensusState) ClientType() string {
	//TODO implement me
	panic("implement me")
}

func (m *ConsensusState) GetTimestamp() uint64 {
	return m.Timestamp
}

func (m *ConsensusState) ValidateBasic() error {
	//TODO implement me
	panic("implement me")
}

func (m *MithrilHeader) Height() uint64 {
	//TODO implement me
	panic("implement me")
}

func (m *MithrilHeader) ConsensusState() exported.ConsensusState {
	layout := "2006-01-02T15:04:05.000000000Z"
	t, err := time.Parse(layout, m.TransactionSnapshotCertificate.Metadata.SealedAt)
	if err != nil {
		return nil
	}
	return &ConsensusState{
		Timestamp:                uint64(t.UnixNano()),
		FirstCertHashLatestEpoch: m.TransactionSnapshotCertificate,
		LatestCertHashTxSnapshot: "",
	}
}

func (m *MithrilHeader) NextValidatorsHash() []byte {
	// TODO: fill data
	return []byte("")
}

func (m *MithrilHeader) ClientType() string {
	//TODO implement me
	panic("implement me")
}

func (m *MithrilHeader) ValidateBasic() error {
	//TODO implement me
	panic("implement me")
}
func (m *Height) IsZero() bool {
	//TODO implement me
	panic("implement me")
}

func (m *Height) LT(height ibcexported.Height) bool {
	//TODO implement me
	panic("implement me")
}

func (m *Height) LTE(height ibcexported.Height) bool {
	//TODO implement me
	panic("implement me")
}

func (m *Height) EQ(height ibcexported.Height) bool {
	//TODO implement me
	panic("implement me")
}

func (m *Height) GT(height ibcexported.Height) bool {
	//TODO implement me
	panic("implement me")
}

func (m *Height) GTE(height ibcexported.Height) bool {
	//TODO implement me
	panic("implement me")
}

func (m *Height) GetRevisionNumber() uint64 {
	return 0
}

func (m *Height) GetRevisionHeight() uint64 {
	return m.RevisionHeight
}

func (m *Height) Increment() ibcexported.Height {
	//TODO implement me
	panic("implement me")
}

func (m *Height) Decrement() (ibcexported.Height, bool) {
	//TODO implement me
	panic("implement me")
}
