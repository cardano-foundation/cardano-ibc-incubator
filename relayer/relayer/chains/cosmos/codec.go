package cosmos

import (
	pbclientstruct "git02.smartosc.com/cardano/ibc-sidechain/relayer/proto/cardano/gateway/sidechain/x/clients/cardano"

	"github.com/cosmos/cosmos-sdk/client"
	"github.com/cosmos/cosmos-sdk/codec"
	"github.com/cosmos/cosmos-sdk/codec/types"
	"github.com/cosmos/cosmos-sdk/std"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/cosmos/cosmos-sdk/types/module"
	"github.com/cosmos/cosmos-sdk/x/auth"
	"github.com/cosmos/cosmos-sdk/x/auth/tx"
	authz "github.com/cosmos/cosmos-sdk/x/authz/module"
	"github.com/cosmos/cosmos-sdk/x/bank"
	"github.com/cosmos/cosmos-sdk/x/crisis"
	"github.com/cosmos/cosmos-sdk/x/distribution"
	feegrant "github.com/cosmos/cosmos-sdk/x/feegrant/module"
	"github.com/cosmos/cosmos-sdk/x/gov"
	govclient "github.com/cosmos/cosmos-sdk/x/gov/client"
	"github.com/cosmos/cosmos-sdk/x/mint"
	"github.com/cosmos/cosmos-sdk/x/params"
	paramsclient "github.com/cosmos/cosmos-sdk/x/params/client"
	"github.com/cosmos/cosmos-sdk/x/slashing"
	"github.com/cosmos/cosmos-sdk/x/staking"
	"github.com/cosmos/cosmos-sdk/x/upgrade"
	upgradeclient "github.com/cosmos/cosmos-sdk/x/upgrade/client"
	"github.com/cosmos/ibc-go/modules/capability"
	ibcfee "github.com/cosmos/ibc-go/v7/modules/apps/29-fee"
	"github.com/cosmos/ibc-go/v7/modules/apps/transfer"
	ibc "github.com/cosmos/ibc-go/v7/modules/core"

	cosmosmodule "git02.smartosc.com/cardano/ibc-sidechain/relayer/relayer/chains/cosmos/module"
	"git02.smartosc.com/cardano/ibc-sidechain/relayer/relayer/chains/cosmos/stride"
	ethermintcodecs "git02.smartosc.com/cardano/ibc-sidechain/relayer/relayer/codecs/ethermint"
	injectivecodecs "git02.smartosc.com/cardano/ibc-sidechain/relayer/relayer/codecs/injective"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
)

var ModuleBasics = []module.AppModuleBasic{
	auth.AppModuleBasic{},
	authz.AppModuleBasic{},
	bank.AppModuleBasic{},
	capability.AppModuleBasic{},
	// TODO: add osmosis governance proposal types here
	// TODO: add other proposal types here
	gov.NewAppModuleBasic(
		[]govclient.ProposalHandler{
			paramsclient.ProposalHandler,
			upgradeclient.LegacyProposalHandler,
			upgradeclient.LegacyCancelProposalHandler,
		},
	),
	crisis.AppModuleBasic{},
	distribution.AppModuleBasic{},
	feegrant.AppModuleBasic{},
	mint.AppModuleBasic{},
	params.AppModuleBasic{},
	slashing.AppModuleBasic{},
	staking.AppModuleBasic{},
	upgrade.AppModuleBasic{},
	transfer.AppModuleBasic{},
	ibc.AppModuleBasic{},
	cosmosmodule.AppModuleBasic{},
	stride.AppModuleBasic{},
	ibcfee.AppModuleBasic{},
}

type Codec struct {
	InterfaceRegistry types.InterfaceRegistry
	Marshaler         codec.Codec
	TxConfig          client.TxConfig
	Amino             *codec.LegacyAmino
}

func MakeCodec(moduleBasics []module.AppModuleBasic, extraCodecs []string) Codec {
	modBasic := module.NewBasicManager(moduleBasics...)
	encodingConfig := MakeCodecConfig()
	std.RegisterLegacyAminoCodec(encodingConfig.Amino)
	std.RegisterInterfaces(encodingConfig.InterfaceRegistry)
	modBasic.RegisterLegacyAminoCodec(encodingConfig.Amino)
	modBasic.RegisterInterfaces(encodingConfig.InterfaceRegistry)
	for _, c := range extraCodecs {
		switch c {
		case "ethermint":
			ethermintcodecs.RegisterInterfaces(encodingConfig.InterfaceRegistry)
			encodingConfig.Amino.RegisterConcrete(&ethermintcodecs.PubKey{}, ethermintcodecs.PubKeyName, nil)
			encodingConfig.Amino.RegisterConcrete(&ethermintcodecs.PrivKey{}, ethermintcodecs.PrivKeyName, nil)
		case "injective":
			injectivecodecs.RegisterInterfaces(encodingConfig.InterfaceRegistry)
			encodingConfig.Amino.RegisterConcrete(&injectivecodecs.PubKey{}, injectivecodecs.PubKeyName, nil)
			encodingConfig.Amino.RegisterConcrete(&injectivecodecs.PrivKey{}, injectivecodecs.PrivKeyName, nil)
		}
	}

	return encodingConfig
}

func MakeCodecConfig() Codec {
	interfaceRegistry := types.NewInterfaceRegistry()
	marshaler := codec.NewProtoCodec(interfaceRegistry)
	return Codec{
		InterfaceRegistry: interfaceRegistry,
		Marshaler:         marshaler,
		TxConfig:          tx.NewTxConfig(marshaler, tx.DefaultSignModes),
		Amino:             codec.NewLegacyAmino(),
	}
}

// PackClientState constructs a new Any packed with the given client state value. It returns
// an error if the client state can't be casted to a protobuf message or if the concrete
// implemention is not registered to the protobuf codec.
func PackClientState(clientState *pbclientstruct.ClientState) (*codectypes.Any, error) {
	anyClientState, err := codectypes.NewAnyWithValue(clientState)
	if err != nil {
		return nil, sdkerrors.Wrap(sdkerrors.ErrPackAny, err.Error())
	}

	return anyClientState, nil
}

func PackClientStateCosmos(clientState *pbclientstruct.ClientState) (*codectypes.Any, error) {
	anyClientState, err := codectypes.NewAnyWithValue(clientState)
	if err != nil {
		return nil, sdkerrors.Wrap(sdkerrors.ErrPackAny, err.Error())
	}

	return anyClientState, nil
}

// PackConsensusState constructs a new Any packed with the given consensus state value. It returns
// an error if the consensus state can't be casted to a protobuf message or if the concrete
// implemention is not registered to the protobuf codec.
func PackConsensusState(consensusState *pbclientstruct.ConsensusState) (*codectypes.Any, error) {
	msg := consensusState
	//if !ok {
	//	return nil, sdkerrors.Wrapf(sdkerrors.ErrPackAny, "cannot proto marshal %T", consensusState)
	//}

	anyConsensusState, err := codectypes.NewAnyWithValue(msg)
	if err != nil {
		return nil, sdkerrors.Wrap(sdkerrors.ErrPackAny, err.Error())
	}

	return anyConsensusState, nil
}
