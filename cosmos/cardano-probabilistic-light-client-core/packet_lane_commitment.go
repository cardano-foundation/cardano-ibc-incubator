package probabilisticcore

import (
	"fmt"
	"strings"

	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/fxamacker/cbor/v2"
)

type packetLaneDatum struct {
	_                         struct{} `cbor:",toarray"`
	Port                      []byte
	Channel                   []byte
	Lane                      uint32
	LaneCount                 uint32
	Version                   uint64
	Root                      []byte
	Commitments               cbor.RawMessage
	Receipts                  cbor.RawMessage
	Acknowledgements          cbor.RawMessage
	MinimumReceiveProofHeight cbor.RawMessage
	MaximumReceiveProofHeight cbor.RawMessage
}

// ExtractPacketLaneRootFromAnchorBlock requires an already authenticated and
// settled anchor block. It checks output identity and uses the block's actual
// height. Only the last surviving output for that lane in the block can supply
// a root, so an earlier empty root cannot prove absence after a later receive.
// The lane policy and lane count must be taken from trusted deployment/channel
// configuration rather than from the relayer's proof.
func ExtractPacketLaneRootFromAnchorBlock(
	anchorBlockCBOR []byte,
	txHash string,
	outputIndex uint32,
	lanePolicy []byte,
	port, channel string,
	lane, laneCount uint32,
) (PacketLaneRoot, error) {
	if len(lanePolicy) != 28 {
		return PacketLaneRoot{}, fmt.Errorf("packet lane policy must be 28 bytes")
	}
	name, err := PacketLaneTokenName(port, channel, lane, laneCount)
	if err != nil {
		return PacketLaneRoot{}, err
	}
	block, err := DecodeLedgerBlock(anchorBlockCBOR)
	if err != nil {
		return PacketLaneRoot{}, err
	}
	if block.BlockNumber() == 0 {
		return PacketLaneRoot{}, fmt.Errorf("packet lane anchor height must be positive")
	}
	transactions := block.Transactions()
	for index, tx := range transactions {
		if !strings.EqualFold(tx.Hash(), txHash) {
			continue
		}
		if transactionIndexIsInvalid(block, uint(index)) || !tx.IsValid() {
			return PacketLaneRoot{}, fmt.Errorf("packet lane transaction is phase-2 invalid")
		}
		outputs := tx.Produced()
		if uint64(outputIndex) >= uint64(len(outputs)) {
			return PacketLaneRoot{}, fmt.Errorf("packet lane output index out of range")
		}
		for _, later := range transactions[index+1:] {
			for _, consumed := range later.Consumed() {
				if strings.EqualFold(consumed.Id().String(), txHash) && consumed.Index() == outputIndex {
					return PacketLaneRoot{}, fmt.Errorf("packet lane output was spent within anchor block")
				}
			}
		}
		output := outputs[outputIndex]
		assets := output.Assets()
		if assets == nil || assets.Asset(ledger.NewBlake2b224(lanePolicy), name) != 1 {
			return PacketLaneRoot{}, fmt.Errorf("packet lane output lacks expected identity token")
		}
		if output.Datum() == nil {
			return PacketLaneRoot{}, fmt.Errorf("packet lane output requires inline datum")
		}
		return decodePacketLaneRoot(output.Datum().Cbor(), block.BlockNumber(), port, channel, lane, laneCount)
	}
	return PacketLaneRoot{}, fmt.Errorf("packet lane transaction not found in anchor block")
}

func decodePacketLaneRoot(raw []byte, height uint64, port, channel string, lane, laneCount uint32) (PacketLaneRoot, error) {
	var tagged cbor.RawTag
	if err := cbor.Unmarshal(raw, &tagged); err != nil || tagged.Number != 121 {
		return PacketLaneRoot{}, fmt.Errorf("packet lane datum must use constructor zero")
	}
	var datum packetLaneDatum
	if err := cbor.Unmarshal(tagged.Content, &datum); err != nil {
		return PacketLaneRoot{}, fmt.Errorf("invalid packet lane datum: %w", err)
	}
	if string(datum.Port) != port || string(datum.Channel) != channel || datum.Lane != lane || datum.LaneCount != laneCount {
		return PacketLaneRoot{}, fmt.Errorf("packet lane datum identity mismatch")
	}
	if _, err := PacketLaneTokenName(port, channel, lane, laneCount); err != nil {
		return PacketLaneRoot{}, err
	}
	if len(datum.Root) != 32 || height == 0 {
		return PacketLaneRoot{}, fmt.Errorf("invalid packet lane root or height")
	}
	return PacketLaneRoot{
		Port: port, Channel: channel, Lane: lane, LaneCount: laneCount,
		Version: datum.Version, Height: height, Root: datum.Root,
	}, nil
}
