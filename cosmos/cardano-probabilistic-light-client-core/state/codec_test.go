package state

import "encoding/json"

// The engine does not own protobuf encoding. Adapter tests cover the real IBC
// codec and persisted Any bytes. These tests exercise state transitions alone.
type jsonTestCodec struct{}

func (jsonTestCodec) EncodeClient(value *ClientState) []byte { return mustJSON(value) }
func (jsonTestCodec) DecodeClient(data []byte) *ClientState {
	value := new(ClientState)
	if err := json.Unmarshal(data, value); err != nil {
		panic(err)
	}
	return value
}
func (jsonTestCodec) EncodeConsensus(value *ConsensusState) []byte { return mustJSON(value) }
func (jsonTestCodec) DecodeConsensus(data []byte) (*ConsensusState, error) {
	value := new(ConsensusState)
	err := json.Unmarshal(data, value)
	return value, err
}
func mustJSON(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return data
}
