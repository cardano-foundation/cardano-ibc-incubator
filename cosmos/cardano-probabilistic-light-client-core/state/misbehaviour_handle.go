package state

import (
	storetypes "cosmossdk.io/store/types"
)

func (cs ClientState) CheckForMisbehaviour(ctx Context, cdc StateCodec, clientStore storetypes.KVStore, msg any) bool {
	if cs.Validate() != nil {
		return false
	}
	evidence, ok := msg.(*Misbehaviour)
	if !ok {
		return false
	}
	conflict, err := cs.verifiedReceiptConflict(ctx, evidence)
	return err == nil && conflict
}

func (cs *ClientState) verifyMisbehaviour(ctx Context, clientStore storetypes.KVStore, cdc StateCodec, evidence *Misbehaviour) error {
	conflict, err := cs.verifiedReceiptConflict(ctx, evidence)
	if err != nil {
		return err
	}
	if !conflict {
		return ErrIBCInvalidMisbehaviour
	}
	return nil
}
