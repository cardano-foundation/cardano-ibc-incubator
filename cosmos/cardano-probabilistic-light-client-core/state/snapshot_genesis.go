package state

import (
	"bytes"
	"encoding/json"
	"fmt"

	storetypes "cosmossdk.io/store/types"
)

type snapshotGenesisObject struct{ Key, Value []byte }
type snapshotGenesis struct {
	Objects []snapshotGenesisObject `json:"objects"`
}

func ValidateSnapshotGenesis(raw []byte) error {
	if len(raw) == 0 {
		return nil
	}
	var genesis snapshotGenesis
	if err := json.Unmarshal(raw, &genesis); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, object := range genesis.Objects {
		if !bytes.HasPrefix(object.Key, []byte("snapshots/v2/")) || len(object.Key) > 256 || len(object.Value) == 0 || len(object.Value) > MaxBlockCBORBytes || seen[string(object.Key)] {
			return fmt.Errorf("invalid or duplicate snapshot genesis object")
		}
		seen[string(object.Key)] = true
	}
	return nil
}
func ImportSnapshotGenesis(store storetypes.KVStore, raw []byte) error {
	if err := ValidateSnapshotGenesis(raw); err != nil {
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	var genesis snapshotGenesis
	if err := json.Unmarshal(raw, &genesis); err != nil {
		return err
	}
	for _, object := range genesis.Objects {
		store.Set(object.Key, object.Value)
	}
	return nil
}
func ExportSnapshotGenesis(store storetypes.KVStore) ([]byte, error) {
	genesis := snapshotGenesis{Objects: []snapshotGenesisObject{}}
	iterator := store.Iterator(nil, nil)
	defer iterator.Close()
	for ; iterator.Valid(); iterator.Next() {
		genesis.Objects = append(genesis.Objects, snapshotGenesisObject{bytes.Clone(iterator.Key()), bytes.Clone(iterator.Value())})
	}
	return json.Marshal(genesis)
}
