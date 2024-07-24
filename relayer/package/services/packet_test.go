package services

import (
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/cardano/relayer/v1/package/dbservice"
	"github.com/cardano/relayer/v1/package/mithril"
	"github.com/cardano/relayer/v1/package/services/helpers"
	channeltypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	"github.com/h2non/gock"
	"github.com/stretchr/testify/require"
	"net/http"
	"os"
	"testing"
)

func TestQueryPacketCommitment(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	chainHandler, err := helpers.GetChainHandler()
	require.NoError(t, err)
	testCases := []struct {
		name        string
		channelId   string
		sequence    uint64
		rows        *sqlmock.Rows
		rows1       *sqlmock.Rows
		httpStatus  int
		queryDbErr  error
		queryDbErr1 error
		expectedErr error
	}{
		{
			name:        "fail to ValidQueryPacketCommitmentParam channelId",
			expectedErr: fmt.Errorf("innvalid channel-id"),
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
		},
		{
			name:      "fail to ValidQueryPacketCommitmentParam sequence",
			channelId: "channel-1",
			rows:      sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),

			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid argument: sequence must be greate than 0"),
		},
		{
			name:      "fail to parse channel id",
			channelId: "channel-",
			sequence:  1,
			rows:      sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),

			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid syntax"),
		},
		{
			name:        "fail to query db FindUtxosByPolicyIdAndPrefixTokenName",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			queryDbErr:  fmt.Errorf("not found"),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			expectedErr: fmt.Errorf("not found"),
		},
		{
			name:        "query does not return any value",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{}),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			expectedErr: fmt.Errorf("no utxos found for policyId"),
		},
		{
			name:        "query utxo's datum empty",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", nil, "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			expectedErr: fmt.Errorf("datum is nil"),
		},
		{
			name:        "decode datum fail",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\x", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			expectedErr: fmt.Errorf("EOF"),
		},
		{
			name:        "packet commitment not found",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d32ff9f4c636f6e6e656374696f6e2d33ff4769637332302d31ff030101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722033ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			expectedErr: fmt.Errorf("packet commitment not found"),
		},
		{
			name:        "packet commitment not found",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d32ff9f4c636f6e6e656374696f6e2d33ff4769637332302d31ff030101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722033ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			expectedErr: fmt.Errorf("packet commitment not found"),
		},
		{
			name:        "fail to query db FindUtxoByPolicyAndTokenNameAndState",
			channelId:   "channel-1",
			sequence:    2,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			queryDbErr1: fmt.Errorf("not found 1"),
			expectedErr: fmt.Errorf("not found 1"),
		},
		{
			name:        "fail to get proof",
			channelId:   "channel-1",
			sequence:    2,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusBadRequest,
			expectedErr: fmt.Errorf("400"),
		},
		{
			name:       "success",
			channelId:  "channel-1",
			sequence:   2,
			rows:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", "assets_policy", "assets_name", 1, 1),
			rows1:      sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus: http.StatusOK,
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
				WillReturnError(tc.queryDbErr).
				WillReturnRows(tc.rows)

			//rows := sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", tc.datum, "\\xbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add", "assets_name", 1, 1)
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
				WillReturnError(tc.queryDbErr1).
				WillReturnRows(tc.rows1)

			//setup mock http
			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/proof/cardano-transaction").
				MatchParam("transaction_hashes", "_hash").
				Persist().
				Reply(tc.httpStatus).
				JSON("{\"certificate_hash\":\"36c93aedd5e22bbdaca1a4df211c2f7720881f2b9f30289e9be551571e66913e\",\"certified_transactions\":[{\"transactions_hashes\":[\"89a81febe6c19bbf5ce26d96530c70b811623df73296cf03f033cffb830fbec9\"],\"proof\":\"7b226d61737465725\"}],\"non_certified_transactions\":[],\"latest_block_number\":27675}")
			defer gock.Off()
			response, err := gateway.QueryPacketCommitment(
				&channeltypes.QueryPacketCommitmentRequest{
					PortId:    "",
					ChannelId: tc.channelId,
					Sequence:  tc.sequence,
				},
			)
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryPacketCommitments(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	testCases := []struct {
		name        string
		channelId   string
		rows        *sqlmock.Rows
		queryErr    error
		expectedErr error
	}{
		{
			name:        "fail to validate channel",
			channelId:   "",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid channel-id"),
		},
		{
			name:        "fail to convert channelId",
			channelId:   "channel-",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid syntax"),
		},
		{
			name:        "fail to query db",
			channelId:   "channel-1",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			queryErr:    fmt.Errorf("not found"),
			expectedErr: fmt.Errorf("not found"),
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
			name:      "success",
			channelId: "channel-1",
			rows:      sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", "assets_policy", "assets_name", 1, 1),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gateway := &Gateway{}
			gateway.DBService = dbService
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
				WillReturnError(tc.queryErr).
				WillReturnRows(tc.rows)
			response, err := gateway.QueryPacketCommitments(&channeltypes.QueryPacketCommitmentsRequest{
				PortId:     "",
				ChannelId:  tc.channelId,
				Pagination: nil,
			})
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryPacketAck(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	testCases := []struct {
		name        string
		channelId   string
		sequence    uint64
		expectedErr error
	}{
		{
			name:        "fail to validate channel",
			channelId:   "",
			expectedErr: fmt.Errorf("invalid channel-id"),
		},
	}
}
