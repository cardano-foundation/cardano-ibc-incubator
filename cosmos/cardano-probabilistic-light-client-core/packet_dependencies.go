package probabilisticcore

import (
	"encoding/hex"
	"fmt"
	"sort"

	"github.com/blinklabs-io/gouroboros/ledger"
)

// PacketDependencies enumerates every input and lane-policy output in a complete
// authenticated body. It selects destination records, not a relayer's delta list.
type PacketInput struct {
	Hash  string
	Index uint32
}

func PacketDependencies(raw, policy []byte) ([]PacketInput, []string, error) {
	if len(policy) != 28 {
		return nil, nil, fmt.Errorf("invalid packet lane policy")
	}
	block, err := DecodeLedgerBlock(raw)
	if err != nil {
		return nil, nil, err
	}
	inputs := []PacketInput{}
	names := map[string]bool{}
	for _, tx := range block.Transactions() {
		for _, input := range tx.Consumed() {
			inputs = append(inputs, PacketInput{input.Id().String(), input.Index()})
		}
		for _, output := range utxoOutputs(tx.Produced()) {
			if assets := output.Assets(); assets != nil {
				for _, name := range assets.Assets(ledger.NewBlake2b224(policy)) {
					if len(name) == 32 {
						names[hex.EncodeToString(name)] = true
					}
				}
			}
		}
	}
	sorted := make([]string, 0, len(names))
	for name := range names {
		sorted = append(sorted, name)
	}
	sort.Strings(sorted)
	return inputs, sorted, nil
}
