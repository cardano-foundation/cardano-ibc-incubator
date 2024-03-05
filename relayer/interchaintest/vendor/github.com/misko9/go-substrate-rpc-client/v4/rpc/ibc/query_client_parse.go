package ibc

import (
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	prototypes "github.com/gogo/protobuf/types"
)

type IdentifiedClientStates []IdentifiedClientState

type IdentifiedClientState struct {
	// client identifier
	// nolint
	ClientId string `protobuf:"bytes,1,opt,name=client_id,json=clientId,proto3" json:"client_id,omitempty" yaml:"client_id"`
	// client state
	// nolint
	ClientState *prototypes.Any `protobuf:"bytes,2,opt,name=client_state,json=clientState,proto3" json:"client_state,omitempty" yaml:"client_state"`
}

func parseIdentifiedClientStates(ics IdentifiedClientStates) (clienttypes.IdentifiedClientStates, error) {
	var clientStates clienttypes.IdentifiedClientStates
	for i := 0; i < len(ics); i++ {
		cs, err := parseAny(ics[i].ClientState)
		if err != nil {
			return nil, err
		}
		clientStates = append(clientStates, clienttypes.IdentifiedClientState{
			ClientState: cs,
			ClientId:    ics[i].ClientId,
		})
	}
	return clientStates, nil
}

type QueryClientStateResponse struct {
	// client state associated with the request identifier
	// nolint
	ClientState *prototypes.Any `protobuf:"bytes,1,opt,name=client_state,json=clientState,proto3" json:"client_state,omitempty"`
	// merkle proof of existence
	Proof []byte `protobuf:"bytes,2,opt,name=proof,proto3" json:"proof,omitempty"`
	// height at which the proof was retrieved
	ProofHeight clienttypes.Height `protobuf:"bytes,3,opt,name=proof_height,json=proofHeight,proto3" json:"proof_height"`
}

func parseQueryClientStateResponse(csr QueryClientStateResponse) (clienttypes.QueryClientStateResponse, error) {
	cs, err := parseAny(csr.ClientState)
	if err != nil {
		return clienttypes.QueryClientStateResponse{}, err
	}

	return clienttypes.QueryClientStateResponse{
		ClientState: cs,
		Proof:       csr.Proof,
		ProofHeight: csr.ProofHeight,
	}, nil
}

type QueryConsensusStateResponse struct {
	// consensus state associated with the client identifier at the given height
	ConsensusState *prototypes.Any `protobuf:"bytes,1,opt,name=consensus_state,json=consensusState,proto3" json:"consensus_state,omitempty"`
	// merkle proof of existence
	Proof []byte `protobuf:"bytes,2,opt,name=proof,proto3" json:"proof,omitempty"`
	// height at which the proof was retrieved
	ProofHeight clienttypes.Height `protobuf:"bytes,3,opt,name=proof_height,json=proofHeight,proto3" json:"proof_height"`
}

func parseQueryConsensusStateResponse(csr QueryConsensusStateResponse) (*clienttypes.QueryConsensusStateResponse, error) {
	cs, err := parseAny(csr.ConsensusState)
	if err != nil {
		return &clienttypes.QueryConsensusStateResponse{}, err
	}

	return &clienttypes.QueryConsensusStateResponse{
		ConsensusState: cs,
		Proof:          csr.Proof,
		ProofHeight:    csr.ProofHeight,
	}, nil
}
