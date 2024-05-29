package mithril

import (
	"fmt"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/ibc-go/v7/modules/core/exported"
)

var _ exported.ClientState = (*ClientState)(nil)
var _ exported.ConsensusState = (*ConsensusState)(nil)

func (m *Height) String() string {
	return fmt.Sprintf("%v", m.MithrilHeight)
}

func (m *ClientState) ClientType() string {
	//TODO implement me
	panic("implement me")
}

func (m *ClientState) GetLatestHeight() exported.Height {
	return &Height{
		MithrilHeight: m.LatestHeight.MithrilHeight,
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
	return &ConsensusState{
		Timestamp:            m.TransactionSnapshotCertificate.Metadata.SealedAt,
		FcHashLatestEpochMsd: "",
		LatestCertHashMsd:    "",
		FcHashLatestEpochTs:  "",
		LatestCertHashTs:     "",
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
