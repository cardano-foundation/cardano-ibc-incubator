package ibc_test

import (
	"fmt"
	"testing"

	"github.com/cardano/relayer/v1/package/services"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest"
)

var gw services.Gateway

func TestQueryBlockResultsDraft(t *testing.T) {
	s := &IBCTestSuite{
		Logger: zaptest.NewLogger(t, zaptest.Level(zap.InfoLevel)),
	}
	s.SetupTestHomeDir(t, "")
	t.Run("QueryBlockResultsDraft Successful", func(t *testing.T) {
		err := gw.NewGateWayService("192.168.11.72:5001", "http://192.168.11.72:8080/aggregator")
		//gw.QueryBlockResults(108685) // connection init
		//result, err := gw.QueryBlockResults(167381) // connection ack
		// gw.QueryBlockResults(147526) // channel init
		//result, err := gw.QueryBlockResults(166928) // channel ack
		//gw.QueryBlockResults(20435) // create client
		//gw.QueryBlockResults(20436) // update client
		result, err := gw.QueryBlockResults(170950) // send packet
		//result, err := gw.QueryConnection("connection-76")
		//result, err := gw.QueryChannel("channel-61")
		fmt.Println(result)
		require.NoError(t, err)
		//require.NotEmpty(t, connection)
	})
}
