package services

import (
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	pbchannel "github.com/cardano/proto-types/go/github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
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
		mithrilData string
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
			name:        "mithril data nil",
			channelId:   "channel-1",
			sequence:    2,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusOK,
			expectedErr: fmt.Errorf("no certified transactions with proof found for packet commitment"),
		},
		{
			name:        "success",
			channelId:   "channel-1",
			sequence:    2,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusOK,
			mithrilData: "{\"transactions_hashes\":[\"89a81febe6c19bbf5ce26d96530c70b811623df73296cf03f033cffb830fbec9\"],\"proof\":\"7b226d61737465725\"}",
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
				JSON(fmt.Sprintf("{\"certificate_hash\":\"36c93aedd5e22bbdaca1a4df211c2f7720881f2b9f30289e9be551571e66913e\",\"certified_transactions\":[%s],\"non_certified_transactions\":[],\"latest_block_number\":27675}", tc.mithrilData))
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
	chainHandler, err := helpers.GetChainHandler()
	require.NoError(t, err)

	testCases := []struct {
		name        string
		channelId   string
		sequence    uint64
		rows        *sqlmock.Rows
		rows1       *sqlmock.Rows
		httpStatus  int
		mithrilData string
		queryDbErr  error
		queryDbErr1 error
		expectedErr error
	}{
		{
			name:        "fail to validate channel",
			channelId:   "",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid channel-id"),
		},
		{
			name:        "fail to validate sequence",
			channelId:   "channel-1",
			sequence:    0,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid argument: sequence must be greate than 0"),
		},
		{
			name:        "fail to convert channelId",
			channelId:   "channel-",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid syntax"),
		},
		{
			name:        "fail to FindUtxosByPolicyIdAndPrefixTokenName",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			queryDbErr:  fmt.Errorf("not found"),
			expectedErr: fmt.Errorf("not found"),
		},
		{
			name:        "query does not return any value",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{}),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
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
			name:        "packetAcknowledgement is nill",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d32ff9f4c636f6e6e656374696f6e2d33ff4769637332302d31ff030101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722033ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			expectedErr: fmt.Errorf(fmt.Sprintf("portID (%s), channelID (%s), sequence (%d)", "", "channel-1", 1)),
		},
		{
			name:        "fail to query db FindUtxoByPolicyAndTokenNameAndState",
			channelId:   "channel-9",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			queryDbErr1: fmt.Errorf("not found 1"),
			expectedErr: fmt.Errorf("not found 1"),
		},
		{
			name:        "fail to get mithril proof",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusBadRequest,
			expectedErr: fmt.Errorf("400"),
		},
		{
			name:        "mithril proof is empty",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusOK,
			expectedErr: fmt.Errorf("no certified transactions with proof found for packet acknowledgement"),
		},
		{
			name:        "success",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusOK,
			mithrilData: "{\"transactions_hashes\":[\"89a81febe6c19bbf5ce26d96530c70b811623df73296cf03f033cffb830fbec9\"],\"proof\":\"7b226d61737465725\"}",
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gw := &Gateway{}
			gw.DBService = dbService
			mithrilService := mithril.NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
			gw.MithrilService = mithrilService

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
				JSON(fmt.Sprintf("{\"certificate_hash\":\"36c93aedd5e22bbdaca1a4df211c2f7720881f2b9f30289e9be551571e66913e\",\"certified_transactions\":[%s],\"non_certified_transactions\":[],\"latest_block_number\":27675}", tc.mithrilData))
			defer gock.Off()

			response, err := gw.QueryPacketAck(&channeltypes.QueryPacketAcknowledgementRequest{
				PortId:    "",
				ChannelId: tc.channelId,
				Sequence:  tc.sequence,
			})

			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryPacketAcks(t *testing.T) {
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
			rows:      sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gw := &Gateway{}
			gw.DBService = dbService
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
			response, err := gw.QueryPacketAcks(&channeltypes.QueryPacketAcknowledgementsRequest{
				ChannelId: tc.channelId,
			})
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryPacketReceipt(t *testing.T) {
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
		mithrilData string
		queryDbErr  error
		queryDbErr1 error
		expectedErr error
	}{
		{
			name:        "fail to validate channel",
			channelId:   "",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid channel-id"),
		},
		{
			name:        "fail to validate sequence",
			channelId:   "channel-1",
			sequence:    0,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid argument: sequence must be greate than 0"),
		},
		{
			name:        "fail to convert channelId",
			channelId:   "channel-",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid syntax"),
		},
		{
			name:        "fail to FindUtxosByPolicyIdAndPrefixTokenName",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			queryDbErr:  fmt.Errorf("not found"),
			expectedErr: fmt.Errorf("not found"),
		},
		{
			name:        "query does not return any value",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{}),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
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
			name:        "fail to query db FindUtxoByPolicyAndTokenNameAndState",
			channelId:   "channel-9",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			queryDbErr1: fmt.Errorf("not found 1"),
			expectedErr: fmt.Errorf("not found 1"),
		},
		{
			name:        "fail to get mithril proof",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusBadRequest,
			expectedErr: fmt.Errorf("400"),
		},
		{
			name:        "mithril proof is empty",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusOK,
			expectedErr: fmt.Errorf("no certified transactions with proof found for packet receipt"),
		},
		{
			name:        "success",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusOK,
			mithrilData: "{\"transactions_hashes\":[\"89a81febe6c19bbf5ce26d96530c70b811623df73296cf03f033cffb830fbec9\"],\"proof\":\"7b226d61737465725\"}",
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gw := &Gateway{}
			gw.DBService = dbService
			mithrilService := mithril.NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
			gw.MithrilService = mithrilService

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
				JSON(fmt.Sprintf("{\"certificate_hash\":\"36c93aedd5e22bbdaca1a4df211c2f7720881f2b9f30289e9be551571e66913e\",\"certified_transactions\":[%s],\"non_certified_transactions\":[],\"latest_block_number\":27675}", tc.mithrilData))
			defer gock.Off()

			response, err := gw.QueryPacketReceipt(&channeltypes.QueryPacketReceiptRequest{
				PortId:    "",
				ChannelId: tc.channelId,
				Sequence:  tc.sequence,
			})

			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryUnrecvPackets(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	testCases := []struct {
		name        string
		channelId   string
		sequence    uint64
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
			sequence:  0,
			rows:      sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDb, mockSql := dbservice.SetUpMockDb(t)
			defer mockDb.Close()
			gw := Gateway{}
			gw.DBService = dbService
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
			response, err := gw.QueryUnrecvPackets(&channeltypes.QueryUnreceivedPacketsRequest{
				ChannelId:                 tc.channelId,
				PacketCommitmentSequences: []uint64{tc.sequence},
			})
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryUnrecvAcks(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	testCases := []struct {
		name        string
		channelId   string
		sequence    uint64
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
			sequence:  0,
			rows:      sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDb, mockSql := dbservice.SetUpMockDb(t)
			defer mockDb.Close()
			gw := Gateway{}
			gw.DBService = dbService
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
			response, err := gw.QueryUnrecvAcks(&channeltypes.QueryUnreceivedAcksRequest{
				ChannelId:          tc.channelId,
				PacketAckSequences: []uint64{tc.sequence},
			})
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryProofUnreceivedPackets(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	chainHandler, err := helpers.GetChainHandler()
	require.NoError(t, err)

	testCases := []struct {
		name              string
		channelId         string
		sequence          uint64
		rows              *sqlmock.Rows
		rows1             *sqlmock.Rows
		httpStatus        int
		httpStatus1       int
		mithrilData       string
		latestBlockNumber string
		queryDbErr        error
		queryDbErr1       error
		expectedErr       error
	}{
		{
			name:        "fail to validate channel",
			channelId:   "",
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid channel-id"),
		},

		{
			name:        "fail to convert channelId",
			channelId:   "channel-",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			expectedErr: fmt.Errorf("invalid syntax"),
		},
		{
			name:        "fail to FindUtxosByPolicyIdAndPrefixTokenName",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
			queryDbErr:  fmt.Errorf("not found"),
			expectedErr: fmt.Errorf("not found"),
		},
		{
			name:        "query does not return any value",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{}),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "datum", "assets_policy", "assets_name", 1, 1),
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
			name:        "fail to query db FindUtxoByPolicyAndTokenNameAndState",
			channelId:   "channel-9",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799f4c6962635f636c69656e742d339fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3440d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3032ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			queryDbErr1: fmt.Errorf("not found 1"),
			expectedErr: fmt.Errorf("not found 1"),
		},
		{
			name:        "fail to get mithril proof",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusBadRequest,
			expectedErr: fmt.Errorf("400"),
		},
		{
			name:        "mithril proof is empty",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusOK,
			expectedErr: fmt.Errorf("no certified transactions found"),
		},
		{
			name:        "fail to GetCertificateByHash",
			channelId:   "channel-1",
			sequence:    1,
			rows:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:       sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:  http.StatusOK,
			httpStatus1: http.StatusBadRequest,
			mithrilData: "{\"transactions_hashes\":[\"89a81febe6c19bbf5ce26d96530c70b811623df73296cf03f033cffb830fbec9\"],\"proof\":\"7b226d61737465725\"}",
			expectedErr: fmt.Errorf(fmt.Sprintf("%v", http.StatusBadRequest)),
		},
		{
			name:              "fail to parse LatestBlockNumber",
			channelId:         "channel-1",
			sequence:          1,
			rows:              sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:             sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:        http.StatusOK,
			httpStatus1:       http.StatusOK,
			mithrilData:       "{\"transactions_hashes\":[\"89a81febe6c19bbf5ce26d96530c70b811623df73296cf03f033cffb830fbec9\"],\"proof\":\"7b226d61737465725\"}",
			latestBlockNumber: "latestBlockNumber",
			expectedErr:       fmt.Errorf("invalid syntax"),
		},
		{
			name:              "success",
			channelId:         "channel-1",
			sequence:          1,
			rows:              sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e736665724a6368616e6e656c2d3137ff9f4d636f6e6e656374696f6e2d3130ff4769637332302d31ff030101a102582046ebd13b376c1fa7ad5a494e051b388114ed4e2ea0709acb4f7873573f61e908a10140a101582008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7cff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722039ffff", "assets_policy", "assets_name", 1, 1),
			rows1:             sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d31ff9f4c636f6e6e656374696f6e2d31ff4769637332302d31ff030101a10258202efc892b80c9a45d11a7b82a5eb3250e518a223787ec86cfc1a6fd2dc84655bda0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722031ffff", fmt.Sprintf("\\x%v", chainHandler.Validators.MintChannel.ScriptHash), "assets_name", 1, 1),
			httpStatus:        http.StatusOK,
			httpStatus1:       http.StatusOK,
			mithrilData:       "{\"transactions_hashes\":[\"89a81febe6c19bbf5ce26d96530c70b811623df73296cf03f033cffb830fbec9\"],\"proof\":\"7b226d61737465725\"}",
			latestBlockNumber: "12",
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gw := &Gateway{}
			gw.DBService = dbService
			mithrilService := mithril.NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
			gw.MithrilService = mithrilService

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
				Times(5).
				Reply(tc.httpStatus).
				JSON(fmt.Sprintf("{\"certificate_hash\":\"36c93aedd5e22bbdaca1a4df211c2f7720881f2b9f30289e9be551571e66913e\",\"certified_transactions\":[%s],\"non_certified_transactions\":[],\"latest_block_number\":27675}", tc.mithrilData))
			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/certificate/36c93aedd5e22bbdaca1a4df211c2f7720881f2b9f30289e9be551571e66913e").
				Reply(tc.httpStatus1).
				JSON(fmt.Sprintf("{\"hash\":\"eb3f5452bfc2f27022c566dd26deaa57b0b626fd3ea96d637831a6509e592550\",\"previous_hash\":\"0f2a960cfbfec1f194e55b88188e06abce8d3c8410f648d86f8b5419c9453af2\",\"epoch\":573,\"signed_entity_type\":{\"CardanoImmutableFilesFull\":{\"network\":\"preview\",\"epoch\":573,\"immutable_file_number\":11464}},\"beacon\":{\"network\":\"preview\",\"epoch\":573,\"immutable_file_number\":11464},\"metadata\":{\"network\":\"preview\",\"version\":\"0.1.0\",\"parameters\":{\"k\":2422,\"m\":20973,\"phi_f\":0.2},\"initiated_at\":\"2024-05-20T09:05:38.997912265Z\",\"sealed_at\":\"2024-05-20T09:09:39.584164398Z\",\"signers\":[]},\"protocol_message\":{\"message_parts\":{\"snapshot_digest\":\"\",\"next_aggregate_verification_key\":\"\",\"latest_block_number\":\"%v\"}},\"signed_message\":\"\",\"aggregate_verification_key\":\"\",\"multi_signature\":\"\",\"genesis_signature\":\"\"}", tc.latestBlockNumber))
			defer gock.Off()

			response, err := gw.QueryProofUnreceivedPackets(&pbchannel.QueryProofUnreceivedPacketsRequest{
				PortId:    "",
				ChannelId: tc.channelId,
				Sequence:  tc.sequence,
			})

			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}
