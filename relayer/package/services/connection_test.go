package services

import (
	"database/sql/driver"
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/cardano/relayer/v1/package/dbservice"
	"github.com/cardano/relayer/v1/package/mithril"
	"github.com/cardano/relayer/v1/package/services/helpers"
	"github.com/h2non/gock"
	"github.com/stretchr/testify/require"
	"net/http"
	"os"
	"testing"
)

func TestQueryConnection(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	chainHandler, err := helpers.GetChainHandler()
	require.NoError(t, err)
	testCases := []struct {
		name            string
		connectionId    string
		firstQueryRows  *sqlmock.Rows
		secondQueryRows *sqlmock.Rows
		httpStatus      int
		returnData      string
		txId            uint64
		args            []driver.Value
		firstQueryErr   error
		secondQueryErr  error
		expectedErr     error
	}{
		{
			name:            "fail convert connectionId",
			connectionId:    "connectionId",
			firstQueryRows:  sqlmock.NewRows([]string{}),
			secondQueryRows: sqlmock.NewRows([]string{}),
			expectedErr:     fmt.Errorf("invalid syntax"),
		},
		{
			name:            "fail query Utxos by PolicyId and PrefixTokenName ",
			connectionId:    "connection-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{}),
			firstQueryErr:   fmt.Errorf("query error"),
			expectedErr:     fmt.Errorf("query error"),
		},
		{
			name:            "query does not return any value",
			connectionId:    "connection-1",
			firstQueryRows:  sqlmock.NewRows([]string{}),
			secondQueryRows: sqlmock.NewRows([]string{}),
			expectedErr:     fmt.Errorf("no utxos found for policyId"),
		},
		{
			name:            "query utxo's datum empty",
			connectionId:    "connection-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", nil, "assets_policy", "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{}),
			expectedErr:     fmt.Errorf("datum is nil"),
		},
		{
			name:            "decode datum fail",
			connectionId:    "connection-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\x", "assets_policy", "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{}),
			expectedErr:     fmt.Errorf("EOF"),
		},
		{
			name:            "fail query Utxo by Policy and TokenName And State",
			connectionId:    "connection-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", "assets_policy", "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintConnection.ScriptHash), "assets_name", 1, 1),
			secondQueryErr:  fmt.Errorf("query error"),
			expectedErr:     fmt.Errorf("query error"),
		},
		{
			name:            "query Utxo by Policy and TokenName And State does not return any value",
			connectionId:    "connection-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", "assets_policy", "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{}),
			expectedErr:     fmt.Errorf("utxo not found"),
		},
		{
			name:            "query mithril fail",
			connectionId:    "connection-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", "assets_policy", "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintConnection.ScriptHash), "assets_name", 1, 1),
			httpStatus:      http.StatusBadRequest,
			returnData:      "[]",
			expectedErr:     fmt.Errorf("%v", http.StatusBadRequest),
		},
		{
			name:            "CertifiedTransactions is empty",
			connectionId:    "connection-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", "assets_policy", "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintConnection.ScriptHash), "assets_name", 1, 1),
			httpStatus:      http.StatusOK,
			returnData:      "[]",
			expectedErr:     fmt.Errorf("no certified transactions with proof found for connection"),
		},
		{
			name:            "success",
			connectionId:    "connection-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", "assets_policy", "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintConnection.ScriptHash), "assets_name", 1, 1),
			httpStatus:      http.StatusOK,
			returnData:      "[{\"transactions_hashes\":[\"89a81febe6c19bbf5ce26d96530c70b811623df73296cf03f033cffb830fbec9\"],\"proof\":\"proof value\"}]",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbservice, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gateway := &Gateway{
				MithrilService: mithril.NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator"),
				DBService:      dbservice,
			}
			// setup mock db
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
				WillReturnError(tc.firstQueryErr).
				WillReturnRows(tc.firstQueryRows)

			mockSql.ExpectQuery(`SELECT 
      tx_out.address AS address, 
      CAST\(generating_tx.hash as TEXT\) AS tx_hash, 
      tx_out.index AS output_index, 
      datum.hash AS datum_hash, 
      CAST\(datum.bytes as TEXT\) AS datum,
      CAST\(ma.policy AS TEXT\) AS assets_policy, 
      ma.name AS assets_name,
      generating_block.block_no AS block_no,
      tx_out.index AS index
    FROM tx_out
    INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
    INNER JOIN multi_asset ma on mto.ident = ma.id 
    INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
    INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
    INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id`).
				WillReturnError(tc.secondQueryErr).
				WillReturnRows(tc.secondQueryRows)

			// setup mock http
			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/proof/cardano-transaction").
				MatchParam("transaction_hashes", "hash_value").
				Persist().
				Reply(tc.httpStatus).
				JSON(fmt.Sprintf("{\"certificate_hash\":\"1e4bdcd158e1824b9deec88701b07fbaaa5527d3e6635198a3d1bab5e4046d93\",\"certified_transactions\":%v,\"non_certified_transactions\":[],\"latest_block_number\":27675}", tc.returnData))
			defer gock.Off()

			connection, err := gateway.QueryConnection(tc.connectionId)
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, connection)
			}
		})
	}
}

func TestQueryConnections(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")

	testCase := []struct {
		name        string
		rows        *sqlmock.Rows
		queryErr    error
		expectedErr error
	}{
		{
			name:        "fail to query UtxosByPolicyIdAndPrefixTokenName",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			queryErr:    fmt.Errorf("query db error"),
			expectedErr: fmt.Errorf("query db error"),
		},
		{
			name:        "query dose not return any value",
			rows:        sqlmock.NewRows([]string{}),
			expectedErr: fmt.Errorf("no utxos found for policyId"),
		},
		{
			name: "query utxo[0]'s datum empty",
			rows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", nil, "assets_policy", "assets_name", 1, 1).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", "assets_policy", "assets_name", 1, 1),
		},
		{
			name:        "decode datum fail",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\x", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("EOF"),
		},
		{
			name: "success",
			rows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4d6962635f636c69656e742d31329fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f57323030302d63617264616e6f2d6d69746872696c2d31334d636f6e6e656374696f6e2d3130d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581a14807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b303130ffff", "assets_policy", "assets_name", 1, 1),
		},
	}

	for _, tc := range testCase {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			// setup mock db
			dbService, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gateway := &Gateway{
				DBService: dbService,
			}
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
				WillReturnError(tc.queryErr).WillReturnRows(tc.rows)

			connections, err := gateway.QueryConnections()
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, connections)
			}

		})
	}
}
