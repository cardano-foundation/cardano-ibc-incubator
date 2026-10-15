package state

import (
	storetypes "cosmossdk.io/store/types"
)

func (cs *ClientState) latestTrustedBlockState(_ storetypes.KVStore, _ StateCodec) (*trustedBlockState, error) {
	counters, err := operationalCertificateCounterMap(cs.LatestCheckpointOperationalCertificateCounters)
	if err != nil {
		return nil, err
	}
	return &trustedBlockState{height: cs.LatestCheckpointHeight, blockHash: cs.LatestCheckpointBlockHash, slot: cs.LatestCheckpointSlot, epoch: cs.LatestCheckpointEpoch, timestamp: cs.LatestCheckpointTimestamp, nonceState: clonePraosNonceState(cs.LatestCheckpointNonceState), poolRegistry: clonePoolRegistry(cs.LatestCheckpointPoolRegistry), settlementCredit: cloneSettlementCredit(cs.LatestCheckpointSettlementCredit), poolProduction: clonePoolProduction(cs.LatestCheckpointPoolProduction), operationalCertificateCounters: counters}, nil
}
