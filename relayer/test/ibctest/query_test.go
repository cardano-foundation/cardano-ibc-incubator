package ibc_test

import (
	"github.com/cardano/relayer/v1/package/services"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest"
	"testing"
)

var gw services.Gateway

func TestQueryBlockResultsDraft(t *testing.T) {
	s := &IBCTestSuite{
		Logger: zaptest.NewLogger(t, zaptest.Level(zap.InfoLevel)),
	}
	s.SetupTestHomeDir(t, "")
	t.Run("QueryBlockResultsDraft Successful", func(t *testing.T) {
		err := gw.NewGateWayService("192.168.11.72:5001", "http://192.168.11.72:8080/aggregator")
		gw.QueryBlockResults(108685) // connection init
		//gw.QueryBlockResultsDraft(20510) // connection ack
		//gw.QueryBlockResultsDraft(20601) // channel init
		//gw.QueryBlockResultsDraft(20681) // channel ack
		//gw.QueryBlockResultsDraft(20435) // create client
		//gw.QueryBlockResultsDraft(20436) // update client
		//connection, err := gw.QueryConnection("connection-18")
		require.NoError(t, err)
		//require.NotEmpty(t, connection)
	})
}
