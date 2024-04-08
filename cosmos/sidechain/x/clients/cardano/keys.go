package cardano

import (
	"encoding/hex"
	"fmt"

	"github.com/cosmos/ibc-go/v8/modules/core/exported"
	"golang.org/x/crypto/sha3"
)

const (
	ModuleName                       = "099-cardano"
	KeyClientSPOsPrefix              = "clientSPOs"
	KeySPOStatePrefix                = "SPOState"
	KeyRegisterCertPrefix            = "registerCert"
	KeyUnregisterCertPrefix          = "unregisterCert"
	KeyUTXOsPrefix                   = "utxos"
	KeyConsensusStateBlockHashPrefix = "consensusStatesBlockHash"

	KeyUTXOClientStatePrefix      = "client"
	KeyUTXOConsensusStatePrefix   = "consensus"
	KeyUTXOConnectionStatePrefix  = "connection"
	KeyUTXOChannelStatePrefix     = "channel"
	KeyUTXONextSequenceRecvPrefix = "nextsequencerecv"
	KeyUTXONextSequenceSendPrefix = "nextsequencesend"
	KeyUTXONextSequenceAckPrefix  = "nextsequenceack"
	KeyUTXOPacketCommitmentPrefix = "commitments"
	KeyUTXOPacketReceiptsPrefix   = "receipts"
	KeyUTXOPacketAcksPrefix       = "acks"

	KeyUTXOClientStateTokenPrefix = "ibc_client"
)

func ClientSPOsKey(epoch uint64) []byte {
	return []byte(ClientSPOsPath(epoch))
}

func ClientUTXOKey(height exported.Height, txHash, txIndex string) []byte {
	return []byte(ClientUTXOPath(height, txHash, txIndex))
}

func SPOStatePath(epochNo uint64) string {
	return fmt.Sprintf("%s/%v", KeySPOStatePrefix, epochNo)
}

func SPOStateKey(epochNo uint64) []byte {
	return []byte(SPOStatePath(epochNo))
}

func ClientSPOsPath(epochNo uint64) string {
	return fmt.Sprintf("%s/%v", KeyClientSPOsPrefix, epochNo)
}

func ClientUTXOPath(height exported.Height, txHash, txIndex string) string {
	return fmt.Sprintf("%s/%s/%s/%s", KeyUTXOsPrefix, height, txHash, txIndex)
}

func ClientUTXOIBCAnyKey(height exported.Height, params ...string) []byte {
	return []byte(ClientUTXOIBCAnyPath(height, params...))
}

func ClientUTXOIBCAnyPath(height exported.Height, params ...string) string {
	var formatString string
	for _, param := range params {
		formatString = formatString + "/" + param
	}

	return fmt.Sprintf("%s/%s", KeyUTXOsPrefix, height) + formatString
}

func ClientUTXOIBCKey(height exported.Height, ibcType, txHash, txIndex string) []byte {
	if ibcType != "" {
		return []byte(ClientUTXOIBCPath(height, ibcType, txHash, txIndex))
	}
	return []byte(ClientUTXOPath(height, txHash, txIndex))
}

func ClientUTXOIBCPath(height exported.Height, ibcType, txHash, txIndex string) string {
	if ibcType != "" {
		return fmt.Sprintf("%s/%s/%s/%s/%s", KeyUTXOsPrefix, height, ibcType, txHash, txIndex)
	}
	return fmt.Sprintf("%s/%s/%s/%s", KeyUTXOsPrefix, height, txHash, txIndex)
}

func IBCTokenPrefix(handlerTokenUnit, ibcType string) string {
	prefixBytes := []byte(ibcType)
	hashPrefix := sha3.New256()
	_, _ = hashPrefix.Write(prefixBytes)
	sha3Prefix := hashPrefix.Sum(nil)

	handlerTokenUnitBytes, _ := hex.DecodeString(handlerTokenUnit)
	hash := sha3.New256()
	_, _ = hash.Write([]byte(handlerTokenUnitBytes))
	sha3 := hash.Sum(nil)
	return hex.EncodeToString(sha3[:20]) + hex.EncodeToString(sha3Prefix[:4])
}

// ConsensusStatePath returns the suffix store key for the consensus state at a
// particular height stored in a client prefixed store.
func ConsensusStateBlockHashPath(height exported.Height) string {
	return fmt.Sprintf("%s/%s", KeyConsensusStateBlockHashPrefix, height)
}

// ConsensusStateKey returns the store key for a the consensus state of a particular
// client stored in a client prefixed store.
func ConsensusStateBlockHashKey(height exported.Height) []byte {
	return []byte(ConsensusStateBlockHashPath(height))
}
