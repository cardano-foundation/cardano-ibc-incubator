package services

import (
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/cardano/relayer/v1/package/dbservice"
	"github.com/cardano/relayer/v1/package/mithril"
	"github.com/h2non/gock"
	"github.com/stretchr/testify/require"
	"net/http"
	"os"
	"testing"
)

func TestQueryChannel(t *testing.T) {

	err := os.Chdir("../../")
	require.Nil(t, err)

	testCases := []struct {
		name        string
		channelId   string
		rows        *sqlmock.Rows
		httpStatus  int
		returnData  string
		queryErr    error
		expectedErr error
	}{
		{
			name:        "fail convert channelId",
			channelId:   "channelId",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid syntax"),
		},
		{
			name:        "fail query",
			channelId:   "channel-1",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			queryErr:    fmt.Errorf("query error"),
			expectedErr: fmt.Errorf("query error"),
		},
		{
			name:        "query does not return any value",
			channelId:   "channel-1",
			rows:        sqlmock.NewRows([]string{}),
			expectedErr: fmt.Errorf("no utxos found for policyId"),
		},
		{
			name:        "query utxo's datum empty",
			channelId:   "channel-1",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", nil, "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("datum is nil"),
		},
		{
			name:        "decode datum fail",
			channelId:   "channel-1",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\x", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("EOF"),
		},
		{
			name:        "query mithril fail",
			channelId:   "channel-1",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d32ff9f4c636f6e6e656374696f6e2d33ff4769637332302d31ff030101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722033ffff", "assets_policy", "assets_name", 1, 1),
			httpStatus:  http.StatusBadRequest,
			returnData:  "[]",
			expectedErr: fmt.Errorf("%v", http.StatusBadRequest),
		},
		{
			name:        "CertifiedTransactions is empty",
			channelId:   "channel-1",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d32ff9f4c636f6e6e656374696f6e2d33ff4769637332302d31ff030101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722033ffff", "assets_policy", "assets_name", 1, 1),
			httpStatus:  http.StatusOK,
			returnData:  "[]",
			expectedErr: fmt.Errorf("no certified transactions with proof found for channel"),
		},
		{
			name:       "success",
			channelId:  "channel-1",
			rows:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d32ff9f4c636f6e6e656374696f6e2d33ff4769637332302d31ff030101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722033ffff", "assets_policy", "assets_name", 1, 1),
			httpStatus: http.StatusOK,
			returnData: "[{\"transactions_hashes\":[\"89a81febe6c19bbf5ce26d96530c70b811623df73296cf03f033cffb830fbec9\"],\"proof\":\"proof value\"}]",
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gateway := &Gateway{}
			gateway.DBService = dbService
			mithrilService := mithril.NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
			gateway.MithrilService = mithrilService
			//setup mock db

			mockSql.ExpectQuery(`SELECT 
        tx_out.address AS address, 
        cast\(generating_tx.hash as TEXT\) AS tx_hash, 
        generating_tx.id AS tx_id,
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
        CAST\(datum.bytes as TEXT\)  AS datum,
        ma.policy AS assets_policy, 
        CAST\(ma.name AS TEXT\) AS assets_name,
        generating_block.block_no AS block_no,
        generating_block.id AS block_id
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id`).
				WillReturnError(tc.queryErr).
				WillReturnRows(tc.rows)

			//setup mock http
			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/proof/cardano-transaction").
				MatchParam("transaction_hashes", "hash_value").
				Persist().
				Reply(tc.httpStatus).
				JSON(fmt.Sprintf("{\"certificate_hash\":\"36c93aedd5e22bbdaca1a4df211c2f7720881f2b9f30289e9be551571e66913e\",\"certified_transactions\":%v,\"non_certified_transactions\":[],\"latest_block_number\":27675}", tc.returnData))
			defer gock.Off()
			channel, err := gateway.QueryChannel(tc.channelId)
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, channel)
			}
		})
	}
}
