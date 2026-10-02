package probabilistic

import (
	"errors"
	"fmt"
	"strings"

	errorsmod "cosmossdk.io/errors"
	state "github.com/cardano-foundation/cardano-ibc-incubator/cosmos/cardano-probabilistic-light-client-core/state"
	"github.com/cosmos/cosmos-sdk/codec"
	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
)

func coreContext(ctx sdk.Context) state.Context {
	height := clienttypes.GetSelfHeight(ctx)
	return state.Context{Time: ctx.BlockTime(), Height: ctx.BlockHeight(), SelfHeight: state.NewHostHeight(height.GetRevisionNumber(), height.GetRevisionHeight())}
}

type coreCodec struct{ codec.BinaryCodec }

func (c coreCodec) EncodeClient(value *state.ClientState) []byte {
	return clienttypes.MustMarshalClientState(c.BinaryCodec, fromCoreClientState(value))
}

func (c coreCodec) DecodeClient(data []byte) *state.ClientState {
	value := clienttypes.MustUnmarshalClientState(c.BinaryCodec, data)
	client, ok := value.(*ClientState)
	if !ok {
		panic(fmt.Errorf("cannot convert %T to %T", value, client))
	}
	return toCoreClientState(client)
}

func (c coreCodec) EncodeConsensus(value *state.ConsensusState) []byte {
	return clienttypes.MustMarshalConsensusState(c.BinaryCodec, fromCoreConsensusState(value))
}

func (c coreCodec) DecodeConsensus(data []byte) (*state.ConsensusState, error) {
	value, err := clienttypes.UnmarshalConsensusState(c.BinaryCodec, data)
	if err != nil {
		return nil, err
	}
	consensus, ok := value.(*ConsensusState)
	if !ok {
		return nil, fmt.Errorf("cannot convert %T to %T", value, consensus)
	}
	return toCoreConsensusState(consensus), nil
}

// Translate neutral IBC errors without changing their text or the host ABCI code.
func adapterError(err error) error {
	if err == nil {
		return nil
	}
	for _, mapping := range ibcErrors {
		if errors.Is(err, mapping.core) {
			if err == mapping.core {
				return mapping.host
			}
			return errorsmod.Wrap(mapping.host, strings.TrimSuffix(err.Error(), ": "+mapping.core.Error()))
		}
	}
	return err
}

var ibcErrors = []struct{ core, host error }{
	{state.ErrIBCConsensusStateNotFound, clienttypes.ErrConsensusStateNotFound},
	{state.ErrIBCInvalidClient, clienttypes.ErrInvalidClient},
	{state.ErrIBCInvalidClientType, clienttypes.ErrInvalidClientType},
	{state.ErrIBCInvalidConsensus, clienttypes.ErrInvalidConsensus},
	{state.ErrIBCInvalidMisbehaviour, clienttypes.ErrInvalidMisbehaviour},
	{state.ErrIBCInvalidSubstitute, clienttypes.ErrInvalidSubstitute},
	{state.ErrIBCUpdateClientFailed, clienttypes.ErrUpdateClientFailed},
}
