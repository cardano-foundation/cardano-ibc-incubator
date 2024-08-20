package ibc_types

import (
	"log"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDecodeIBCModuleRedeemerSchema(t *testing.T) {

	t.Run("IBC Module Redeemer Schema Successfully", func(t *testing.T) {
		ibcModuleEncoded := "d8799fd87f9f4a6368616e6e656c2d3531d8799fd8799f4101ffffd8799fd8799f457374616b654432303030582d636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b365838323437353730623862613764633732356539666633376539373537623831343862346435613132353935386564616332666434343137623840ffffffff"
		ibcModuleRedeemer, err := DecodeIBCModuleRedeemerSchema(ibcModuleEncoded)
		require.Equal(t, nil, err)

		log.Println(ibcModuleRedeemer)
	})
}
