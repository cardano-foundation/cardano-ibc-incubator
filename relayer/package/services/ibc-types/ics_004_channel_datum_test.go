package ibc_types

import (
	"github.com/stretchr/testify/require"
	"log"
	"testing"
)

func TestDecodeChannelDatum(t *testing.T) {
	t.Run("Test Channel Datum Successful", func(t *testing.T) {
		encodedChannelDatum := "d8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3132ff9f4c636f6e6e656374696f6e2d30ff4769637332302d31ff080101a20658202e7b0da49c61e211bdd68dcf3683a6e38114cd70f603c741d96b5febda3e8d91075820e7645428191904b28dfdf89b76df535e47e3481e3ec6316229590cf5700ec2e0a0a0ff48706f72742d313030d8799f581c92d79a1deb5bd28fc3ae8a5a87cc40b85058d460e5a9f014af38c59d58190400133a8cda76ec1809da03248054e30ff629f5239b722030ffff"
		channelDatum, err := DecodeChannelDatumSchema(encodedChannelDatum)
		require.Equal(t, nil, err)

		log.Println(channelDatum)
	})
}
