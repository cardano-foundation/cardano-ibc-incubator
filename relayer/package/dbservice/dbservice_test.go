package dbservice

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"testing"
)

//func TestQueryConnectionAndChannelUTxOs(t *testing.T) {
//	err := os.Chdir("../..")
//	assert.Nil(t, err)
//	err = godotenv.Load()
//	ConnectToDb(&DatabaseInfo{
//		Name:     os.Getenv(constant.DbName),
//		Driver:   os.Getenv(constant.DbDriver),
//		Username: os.Getenv(constant.DbUsername),
//		Password: os.Getenv(constant.DbPassword),
//		SSLMode:  os.Getenv(constant.DbSslMode),
//		Host:     os.Getenv(constant.DbHost),
//		Port:     os.Getenv(constant.DbPort),
//	})
//	db := NewDBService()
//	utxos, err := db.QueryConnectionAndChannelUTxOs([]uint64{18547, 19058, 67460, 77751, 78093}, "e1ade62db0694fa015abd37586d478858431a4c05f197ab7e6a99561", "3ea7ca437a63e76bb45e59255779a7dca2b1f00d3d3877cffcde3699")
//
//	fmt.Println(utxos)
//	require.Contains(t, err, "EXPIRED")
//}

func SetUpMockDb(t *testing.T) (*DBService, *sql.DB, sqlmock.Sqlmock) {
	mockDB, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("an error '%s' was not expected when opening a stub database connection", err)
	}
	dialector := postgres.New(postgres.Config{
		Conn:       mockDB,
		DriverName: "postgres",
	})
	db, err := gorm.Open(dialector, &gorm.Config{})
	if err != nil {
		t.Fatalf("an error '%s' was not expected when opening a gorm database connection", err)

	}
	return &DBService{
		DB: db,
	}, mockDB, mock
}

func TestFindUtxosByPolicyIdAndPrefixTokenName(t *testing.T) {
	dbService, mockDB, mockSql := SetUpMockDb(t)
	defer mockDB.Close()
	testCases := []struct {
		name        string
		policyId    string
		prefixToken string
		args        []driver.Value
		expectedErr error
	}{
		{
			name:        "success",
			policyId:    "",
			prefixToken: "",
			args:        []driver.Value{"\\x", "\\x"},
			expectedErr: nil,
		},
		{
			name:        "fail",
			policyId:    "",
			prefixToken: "",
			args:        []driver.Value{"\\x", "\\x"},
			expectedErr: fmt.Errorf("not found"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rows := sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1)
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
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE ma.policy = \$1 AND position\(\$2::bytea in ma.name\) > 0
      ORDER BY block_no DESC;`).
				WithArgs(tc.args...).
				WillReturnError(tc.expectedErr).
				WillReturnRows(rows)
			response, err := dbService.FindUtxosByPolicyIdAndPrefixTokenName(tc.policyId, tc.prefixToken)

			if tc.expectedErr != nil {
				require.EqualError(t, err, tc.expectedErr.Error())
			} else {
				require.Nil(t, err)
				require.NotNil(t, response)
			}
		})
	}

}
func TestFindUtxoByPolicyAndTokenNameAndState(t *testing.T) {
	dbService, mockDB, mockSql := SetUpMockDb(t)
	defer mockDB.Close()
	testCases := []struct {
		name                 string
		policyId             string
		prefixToken          string
		state                string
		mintConnScriptHash   string
		minChannelScriptHash string
		args                 []driver.Value
		datum                string
		queryErr             error
		decodeErr            error
		expectedErr          error
	}{
		{
			name:                 "success",
			policyId:             "",
			prefixToken:          "",
			state:                "STATE_INIT",
			mintConnScriptHash:   "bdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add",
			minChannelScriptHash: "0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec",
			args:                 []driver.Value{"\\x", "\\x"},
			datum:                "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff",
			expectedErr:          nil,
		},

		{
			name:                 "fail to query",
			policyId:             "",
			prefixToken:          "",
			state:                "STATE_INIT",
			mintConnScriptHash:   "bdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add",
			minChannelScriptHash: "0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec",
			args:                 []driver.Value{"\\x", "\\x"},
			datum:                "\\x",
			queryErr:             fmt.Errorf("not found"),
			expectedErr:          fmt.Errorf("not found"),
		},

		{
			name:                 "fail to DecodeConnectionDatumSchema",
			policyId:             "",
			prefixToken:          "",
			state:                "STATE_INIT",
			mintConnScriptHash:   "bdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add",
			minChannelScriptHash: "0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec",
			args:                 []driver.Value{"\\x", "\\x"},
			datum:                "\\x",
			decodeErr:            fmt.Errorf("EOF"),
			expectedErr:          fmt.Errorf("EOF"),
		},

		{
			name:                 "proof is nil",
			policyId:             "",
			prefixToken:          "",
			state:                "1",
			mintConnScriptHash:   "bdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add",
			minChannelScriptHash: "0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec",
			args:                 []driver.Value{"\\x", "\\x"},
			datum:                "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff",
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rows := sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", tc.datum, "\\xbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add", "assets_name", 1, 1)
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
    INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
    WHERE ma.policy = \$1 AND position\(\$2::bytea in ma.name\) > 0
    ORDER BY block_no DESC;`).
				WithArgs(tc.args...).
				WillReturnError(tc.queryErr).
				WillReturnRows(rows)
			response, err := dbService.FindUtxoByPolicyAndTokenNameAndState(tc.policyId, tc.prefixToken, tc.state, tc.mintConnScriptHash, tc.minChannelScriptHash)
			if tc.expectedErr != nil {
				require.EqualError(t, err, tc.expectedErr.Error())
			} else if tc.name == "proof is nil" {
				require.Nil(t, err)
				require.Nil(t, response)
			} else {
				require.Nil(t, err)
				require.NotNil(t, response)
			}
		})
	}
}

func TestQueryConnectionAndChannelUTxOs(t *testing.T) {
	dbService, mockDB, mockSql := SetUpMockDb(t)
	defer mockDB.Close()
	testCases := []struct {
		name                  string
		cardanoHeight         []uint64
		mintConnScriptHash    string
		mintChannelScriptHash string
		args                  []driver.Value
		queryErr              error
		expectedErr           error
	}{
		{
			name:                  "success",
			cardanoHeight:         []uint64{18547},
			mintConnScriptHash:    "",
			mintChannelScriptHash: "",
			args:                  []driver.Value{18547, "\\x", "\\x"},
			expectedErr:           nil,
		},
		{
			name:                  "fail to query",
			cardanoHeight:         []uint64{18547},
			mintConnScriptHash:    "",
			mintChannelScriptHash: "",
			args:                  []driver.Value{18547, "\\x", "\\x"},
			queryErr:              fmt.Errorf("not found"),
			expectedErr:           fmt.Errorf("not found"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rows := sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1)
			mockSql.ExpectQuery(`SELECT
        tx_out.address AS address, 
        generating_tx.hash AS tx_hash,
        generating_tx.id AS tx_id,
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
        datum.bytes AS datum,
        ma.policy AS assets_policy, 
        ma.name AS assets_name
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
      WHERE generating_block.block_no in \(\$1\) AND \(position\(\$2::bytea in ma.policy\) > 0 or position\(\$3::bytea in ma.policy\) > 0 \);`).
				WithArgs(tc.args...).
				WillReturnError(tc.queryErr).
				WillReturnRows(rows)
			response, err := dbService.QueryConnectionAndChannelUTxOs(tc.cardanoHeight, tc.mintConnScriptHash, tc.mintChannelScriptHash)
			if tc.expectedErr != nil {
				require.EqualError(t, err, tc.expectedErr.Error())
			} else {
				require.Nil(t, err)
				require.NotNil(t, response)
			}
		})
	}
}

func TestQueryRedeemersByTransactionId(t *testing.T) {
	dbService, mockDB, mockSql := SetUpMockDb(t)
	defer mockDB.Close()
	testCases := []struct {
		name           string
		txId           uint64
		mintScriptHash string
		spendAddress   string
		args           []driver.Value
		queryErr       error
		expectedErr    error
	}{
		{
			name:           "success",
			txId:           1,
			mintScriptHash: "",
			spendAddress:   "",
			args:           []driver.Value{1, "\\x", ""},
			expectedErr:    nil,
		},
		{
			name:           "fail query",
			txId:           1,
			mintScriptHash: "",
			spendAddress:   "",
			args:           []driver.Value{1, "\\x", ""},
			queryErr:       fmt.Errorf("not found"),
			expectedErr:    fmt.Errorf("not found"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rows := sqlmock.NewRows([]string{"data", "type"}).AddRow("data", "type")
			mockSql.ExpectQuery(`SELECT distinct rd_data.bytes as data, rd.purpose as type
    FROM redeemer rd
    INNER JOIN redeemer_data as rd_data on rd.redeemer_data_id = rd_data.id
    LEFT JOIN tx_in generating_tx_in on generating_tx_in.redeemer_id = rd.id
    LEFT JOIN tx_out generating_tx_out on generating_tx_in.tx_out_id = generating_tx_out.tx_id and generating_tx_out."index" = generating_tx_in.tx_out_index
    WHERE rd.tx_id = \$1 AND \(rd.script_hash = \$2 OR generating_tx_out.address = \$3\)`).
				WithArgs(tc.args...).WillReturnError(tc.queryErr).WillReturnRows(rows)
			response, err := dbService.QueryRedeemersByTransactionId(tc.txId, tc.mintScriptHash, tc.spendAddress)
			if tc.expectedErr != nil {
				require.EqualError(t, err, tc.expectedErr.Error())
			} else {
				require.Nil(t, err)
				require.NotNil(t, response)
			}
		})
	}
}

func TestQueryClientOrAuthHandlerUTxOsByHeight(t *testing.T) {
	dbService, mockDB, mockSql := SetUpMockDb(t)
	defer mockDB.Close()
	testCases := []struct {
		name            string
		policyId        string
		scHash          string
		clientTokenName string
		height          uint64
		AssetsPolicy    string
		args            []driver.Value
		queryErr        error
		expectedErr     error
	}{
		{
			name:            "success",
			policyId:        "3532663137666236323436333437383839633133343330313132336131663236",
			scHash:          "",
			clientTokenName: "",
			height:          1,
			AssetsPolicy:    "52f17fb6246347889c134301123a1f26",
			args:            []driver.Value{1, "\\x3532663137666236323436333437383839633133343330313132336131663236", "\\x"},
			expectedErr:     nil,
		},
		{
			name:            "success",
			policyId:        "",
			scHash:          "3532663137666236323436333437383839633133343330313132336131663236",
			clientTokenName: "",
			height:          1,
			AssetsPolicy:    "52f17fb6246347889c134301123a1f26",
			args:            []driver.Value{1, "\\x", "\\x3532663137666236323436333437383839633133343330313132336131663236"},
			expectedErr:     nil,
		},
		{
			name:            "fail query",
			policyId:        "3532663137666236323436333437383839633133343330313132336131663236",
			scHash:          "",
			clientTokenName: "",
			height:          1,
			AssetsPolicy:    "52f17fb6246347889c134301123a1f26",
			args:            []driver.Value{1, "\\x3532663137666236323436333437383839633133343330313132336131663236", "\\x"},
			queryErr:        fmt.Errorf("not found"),
			expectedErr:     fmt.Errorf("not found"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rows := sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "index"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", tc.AssetsPolicy, "assets_name", 1, 1)
			mockSql.ExpectQuery(`SELECT 
        tx_out.address AS address, 
        generating_tx.hash AS tx_hash, 
        generating_tx.id AS tx_id, 
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
       	datum.bytes AS datum,
        ma.policy  AS assets_policy, 
        ma.name AS assets_name,
        generating_block.block_no AS block_no,
        tx_out.index AS index
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
	  WHERE generating_block.block_no = \$1 AND \(ma.policy = \$2 OR ma.policy = \$3\);`).
				WithArgs(tc.args...).WillReturnError(tc.queryErr).WillReturnRows(rows)
			response, err := dbService.QueryClientOrAuthHandlerUTxOsByHeight(tc.policyId, tc.scHash, tc.clientTokenName, tc.height)
			if tc.expectedErr != nil {
				require.EqualError(t, err, tc.expectedErr.Error())
			} else {
				require.Nil(t, err)
				require.NotNil(t, response)
			}
		})
	}
}

func TestQueryClientOrAuthHandlerUTxOs(t *testing.T) {
	dbService, mockDB, mockSql := SetUpMockDb(t)
	defer mockDB.Close()
	testCases := []struct {
		name            string
		policyId        string
		scHash          string
		clientTokenName string
		assetsPolicy    string
		assetsName      string
		args            []driver.Value
		queryErr        error
		expectedErr     error
	}{
		{
			name:            "success",
			policyId:        "3532663137666236323436333437383839633133343330313132336131663236",
			scHash:          "",
			clientTokenName: "",
			assetsPolicy:    "52f17fb6246347889c134301123a1f26",
			args:            []driver.Value{"\\x3532663137666236323436333437383839633133343330313132336131663236", "\\x"},
			expectedErr:     nil,
		},
		{
			name:            "success",
			policyId:        "",
			scHash:          "3532663137666236323436333437383839633133343330313132336131663236",
			clientTokenName: "3532",
			assetsPolicy:    "52f17fb6246347889c134301123a1f26",
			assetsName:      "52f17fb6246347889c134301123a1f26",
			args:            []driver.Value{"\\x", "\\x3532663137666236323436333437383839633133343330313132336131663236"},
			expectedErr:     nil,
		},
		{
			name:            "fail query",
			policyId:        "",
			scHash:          "3532663137666236323436333437383839633133343330313132336131663236",
			clientTokenName: "3532",
			assetsPolicy:    "52f17fb6246347889c134301123a1f26",
			assetsName:      "52f17fb6246347889c134301123a1f26",
			args:            []driver.Value{"\\x", "\\x3532663137666236323436333437383839633133343330313132336131663236"},
			queryErr:        fmt.Errorf("not founds"),
			expectedErr:     fmt.Errorf("not founds"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rows := sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "index"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", tc.assetsPolicy, tc.assetsName, 1, 1)
			mockSql.ExpectQuery(`SELECT 
        tx_out.address AS address, 
        generating_tx.hash AS tx_hash, 
        generating_tx.id AS tx_id, 
        tx_out.index AS output_index, 
        datum.hash AS datum_hash, 
       	datum.bytes AS datum,
        ma.policy  AS assets_policy, 
        ma.name AS assets_name,
        generating_block.block_no AS block_no,
        tx_out.index AS index
      FROM tx_out
      INNER JOIN ma_tx_out mto on mto.tx_out_id = tx_out.id
      INNER JOIN multi_asset ma on mto.ident = ma.id 
      INNER JOIN datum AS datum on datum.id = tx_out.inline_datum_id
      INNER JOIN tx AS generating_tx on generating_tx.id = tx_out.tx_id
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
	  WHERE  \(ma.policy = \$1 OR ma.policy = \$2\);`).
				WithArgs(tc.args...).WillReturnError(tc.queryErr).WillReturnRows(rows)
			response, err := dbService.QueryClientOrAuthHandlerUTxOs(tc.policyId, tc.scHash, tc.clientTokenName)
			if tc.expectedErr != nil {
				require.EqualError(t, err, tc.expectedErr.Error())
			} else {
				require.Nil(t, err)
				require.NotNil(t, response)
			}
		})
	}
}

func TestFindHeightByTxHash(t *testing.T) {
	dbService, mockDB, mockSql := SetUpMockDb(t)
	defer mockDB.Close()
	testCases := []struct {
		name        string
		txHash      string
		args        []driver.Value
		queryErr    error
		expectedErr error
	}{
		{
			name:        "success",
			txHash:      "",
			args:        []driver.Value{""},
			expectedErr: nil,
		},
		{
			name:        "fail query",
			txHash:      "",
			args:        []driver.Value{""},
			queryErr:    fmt.Errorf("not found"),
			expectedErr: fmt.Errorf("not found"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rows := sqlmock.NewRows([]string{"block_no"}).AddRow(1)
			mockSql.ExpectQuery(`SELECT
        generating_block.block_no AS height
      FROM tx AS generating_tx
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id
	  WHERE generating_tx.hash = \$1;`).
				WithArgs(tc.args...).WillReturnError(tc.queryErr).WillReturnRows(rows)
			response, err := dbService.FindHeightByTxHash(tc.txHash)
			if tc.expectedErr != nil {
				require.EqualError(t, err, tc.expectedErr.Error())
			} else {
				require.Nil(t, err)
				require.NotNil(t, response)
			}
		})
	}
}
