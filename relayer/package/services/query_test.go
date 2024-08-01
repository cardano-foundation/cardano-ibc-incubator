package services

import (
	"context"
	"encoding/hex"
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/cardano/relayer/v1/package/dbservice"
	"github.com/cardano/relayer/v1/package/dbservice/dto"
	mithrilpacket "github.com/cardano/relayer/v1/package/mithril"
	mithrilservice "github.com/cardano/relayer/v1/package/mithril"
	"github.com/cardano/relayer/v1/package/services/helpers"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos/mithril"
	"github.com/stretchr/testify/require"
	"net/http"
	"os"
	"strings"

	"github.com/h2non/gock"

	"testing"
)

func TestQueryIBCHeader(t *testing.T) {
	testCases := []struct {
		name         string
		httpStatus   int
		httpStatus1  int
		httpStatus2  int
		httpStatus3  int
		height       int
		CurrentEpoch uint64
		returnEpoch  uint64
		expectedErr  error
	}{
		{
			name:        "fail to get mithril GetCardanoTransactionsSetSnapshot",
			httpStatus:  http.StatusBadRequest,
			expectedErr: fmt.Errorf("400"),
		},
		{
			name:        "BlockNumber: Missing mithril height",
			httpStatus:  http.StatusOK,
			height:      2324689,
			expectedErr: fmt.Errorf("Could not find snapshot with height"),
		},
		{
			name:        "fail to get mithril GetCertificateByHash",
			httpStatus:  http.StatusOK,
			height:      2324489,
			httpStatus1: http.StatusBadRequest,
			expectedErr: fmt.Errorf("400"),
		},
		{
			name:         "fail to get mithril GetListMithrilStakeDistributions",
			httpStatus:   http.StatusOK,
			height:       2324489,
			CurrentEpoch: 641,
			httpStatus1:  http.StatusOK,
			httpStatus2:  http.StatusBadRequest,
			expectedErr:  fmt.Errorf("400"),
		},
		{
			name:         "Could not find stake distribution with epoch",
			httpStatus:   http.StatusOK,
			height:       2324489,
			CurrentEpoch: 641,
			returnEpoch:  642,
			httpStatus1:  http.StatusOK,
			httpStatus2:  http.StatusOK,
			expectedErr:  fmt.Errorf("Could not find stake distribution with epoch"),
		},
		{
			name:         "fail to get mithril GetListMithrilStakeDistributions #2",
			httpStatus:   http.StatusOK,
			height:       2324489,
			CurrentEpoch: 641,
			returnEpoch:  640,
			httpStatus1:  http.StatusOK,
			httpStatus2:  http.StatusOK,
			httpStatus3:  http.StatusBadRequest,
			expectedErr:  fmt.Errorf("400"),
		},
		{
			name:         "success",
			httpStatus:   http.StatusOK,
			height:       2324489,
			CurrentEpoch: 641,
			returnEpoch:  640,
			httpStatus1:  http.StatusOK,
			httpStatus2:  http.StatusOK,
			httpStatus3:  http.StatusOK,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			gw := &Gateway{}
			mithrilService := mithrilservice.NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
			gw.MithrilService = mithrilService

			//setup mock http
			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/artifact/cardano-transactions").
				Reply(tc.httpStatus).
				JSON("[{\"merkle_root\":\"f0ee0e2015a501de781d9a22f2baa360f723e0b07688668ab361b89eab9a5ce3\",\"epoch\":640,\"block_number\":2324609,\"hash\":\"75144521b1886c197ebdfdfe1119d89ea04d8f0b70096b70109d3647290df518\",\"certificate_hash\":\"bdf6a5f4e0d3731f482e984966f8456daa4dcf1d07992f3f21dac30e3c41a963\",\"created_at\":\"2024-07-26T07:00:17.954696409Z\"},{\"merkle_root\":\"1fbe314bd9fe5627f10de40d6d1a0a386e91885716c789ca1b7e89a18309d4d3\",\"epoch\":640,\"block_number\":2324579,\"hash\":\"9ba7c113477696cad8cecc75d36ccb18993e96c99af94862ad0a6a65c7e54005\",\"certificate_hash\":\"941afe90ebe96b603bddfea7fd1ab246cf9e69c9c873548128369c828858b751\",\"created_at\":\"2024-07-26T06:49:58.944499120Z\"}]")

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/certificate/941afe90ebe96b603bddfea7fd1ab246cf9e69c9c873548128369c828858b751").
				Reply(tc.httpStatus1).
				JSON("{\"hash\":\"941afe90ebe96b603bddfea7fd1ab246cf9e69c9c873548128369c828858b751\",\"previous_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"epoch\":640,\"signed_entity_type\":{\"CardanoTransactions\":[640,2324579]},\"beacon\":{\"network\":\"preview\",\"epoch\":640,\"immutable_file_number\":12801},\"metadata\":{\"network\":\"preview\",\"version\":\"0.1.0\",\"parameters\":{\"k\":2422,\"m\":20973,\"phi_f\":0.2},\"initiated_at\":\"2024-07-26T06:46:56.178599138Z\",\"sealed_at\":\"2024-07-26T06:49:56.736675144Z\",\"signers\":[{\"party_id\":\"pool1r0tln8nct3mpyvehgy6uu3cdlmjnmtr2fxjcqnfl6v0qg0we42e\",\"stake\":9497629046},{\"party_id\":\"pool1t9uuagsat8hlr0n0ga4wzge0jxlyjuhl6mugrm8atc285vzkf2e\",\"stake\":9497629046},{\"party_id\":\"pool1vapqexnsx6hvc588yyysxpjecf3k43hcr5mvhmstutuvy085xpa\",\"stake\":9497432569}]},\"protocol_message\":{\"message_parts\":{\"cardano_transactions_merkle_root\":\"1fbe314bd9fe5627f10de40d6d1a0a386e91885716c789ca1b7e89a18309d4d3\",\"next_aggregate_verification_key\":\"7b226d745f636f6d6d69746d656e74223a7b22726f6f74223a5b36312c3230312c36312c3230312c3136392c35342c3234372c33362c3138392c3137372c33332c3139382c3230312c3137302c362c39312c3137372c39342c3235312c3230342c3235342c3132362c3135372c3134342c302c342c32302c3233322c33322c3139362c3135332c32305d2c226e725f6c6561766573223a332c22686173686572223a6e756c6c7d2c22746f74616c5f7374616b65223a32383439323639303636317d\",\"latest_block_number\":\"2324579\"}},\"signed_message\":\"d322517bea19aac3026c896c356ef34aa6b65c29c7c49f1737811c3c5f5cf27a\",\"aggregate_verification_key\":\"7b226d745f636f6d6d69746d656e74223a7b22726f6f74223a5b35352c36342c3234382c3231312c3132342c3137342c3230372c3230382c3135342c3230322c3233352c31352c35362c34382c38352c3138372c3230322c3235312c35382c3133342c31362c3130382c3137352c3137392c3138302c39332c3130382c31372c38362c37302c35332c3138375d2c226e725f6c6561766573223a332c22686173686572223a6e756c6c7d2c22746f74616c5f7374616b65223a32383439323639303636317d\",\"multi_signature\":\"\",\"genesis_signature\":\"\"}")

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/artifact/mithril-stake-distributions").
				Reply(tc.httpStatus2).
				JSON(fmt.Sprintf("[{\"epoch\":%v,\"hash\":\"fbbe55ca0230d515b1d67e5301f386ac51dc7273488cad3b7d73a0a80acb0f87\",\"certificate_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"created_at\":\"2024-07-26T00:06:03.543232456Z\"},{\"epoch\":638,\"hash\":\"a0c9f58f4f7b94c1583f7456bece2fd3153286275f92eec4dbac36c8ed95fb60\",\"certificate_hash\":\"9a767bd7456ba4713db9f187a912d1dcb1ba94ee153636161503f3ee0ee437ee\",\"created_at\":\"2024-07-24T00:06:30.492172869Z\"}]", tc.returnEpoch))

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/certificate/12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45").
				Reply(tc.httpStatus3).
				JSON("{\"hash\":\"941afe90ebe96b603bddfea7fd1ab246cf9e69c9c873548128369c828858b751\",\"previous_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"epoch\":640,\"signed_entity_type\":{\"CardanoTransactions\":[640,2324579]},\"beacon\":{\"network\":\"preview\",\"epoch\":640,\"immutable_file_number\":12801},\"metadata\":{\"network\":\"preview\",\"version\":\"0.1.0\",\"parameters\":{\"k\":2422,\"m\":20973,\"phi_f\":0.2},\"initiated_at\":\"2024-07-26T06:46:56.178599138Z\",\"sealed_at\":\"2024-07-26T06:49:56.736675144Z\",\"signers\":[{\"party_id\":\"pool1r0tln8nct3mpyvehgy6uu3cdlmjnmtr2fxjcqnfl6v0qg0we42e\",\"stake\":9497629046},{\"party_id\":\"pool1t9uuagsat8hlr0n0ga4wzge0jxlyjuhl6mugrm8atc285vzkf2e\",\"stake\":9497629046},{\"party_id\":\"pool1vapqexnsx6hvc588yyysxpjecf3k43hcr5mvhmstutuvy085xpa\",\"stake\":9497432569}]},\"protocol_message\":{\"message_parts\":{\"cardano_transactions_merkle_root\":\"1fbe314bd9fe5627f10de40d6d1a0a386e91885716c789ca1b7e89a18309d4d3\",\"next_aggregate_verification_key\":\"7b226d745f636f6d6d69746d656e74223a7b22726f6f74223a5b36312c3230312c36312c3230312c3136392c35342c3234372c33362c3138392c3137372c33332c3139382c3230312c3137302c362c39312c3137372c39342c3235312c3230342c3235342c3132362c3135372c3134342c302c342c32302c3233322c33322c3139362c3135332c32305d2c226e725f6c6561766573223a332c22686173686572223a6e756c6c7d2c22746f74616c5f7374616b65223a32383439323639303636317d\",\"latest_block_number\":\"2324579\"}},\"signed_message\":\"d322517bea19aac3026c896c356ef34aa6b65c29c7c49f1737811c3c5f5cf27a\",\"aggregate_verification_key\":\"7b226d745f636f6d6d69746d656e74223a7b22726f6f74223a5b35352c36342c3234382c3231312c3132342c3137342c3230372c3230382c3135342c3230322c3233352c31352c35362c34382c38352c3138372c3230322c3235312c35382c3133342c31362c3130382c3137352c3137392c3138302c39332c3130382c31372c38362c37302c35332c3138375d2c226e725f6c6561766573223a332c22686173686572223a6e756c6c7d2c22746f74616c5f7374616b65223a32383439323639303636317d\",\"multi_signature\":\"\",\"genesis_signature\":\"\"}")
			defer gock.Off()

			response, err := gw.QueryIBCHeader(context.Background(), int64(tc.height), &mithril.ClientState{CurrentEpoch: tc.CurrentEpoch})
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestGetClientDatum(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	chainHandler, err := helpers.GetChainHandler()
	require.NoError(t, err)
	policyIdDecodeString, err := hex.DecodeString(chainHandler.HandlerAuthToken.PolicyID)
	require.NoError(t, err)

	datumDecodeString, err := hex.DecodeString("d8799fd8799f00000080ffd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff")
	testCase := []struct {
		name            string
		clientId        string
		firstQueryRows  *sqlmock.Rows
		secondQueryRows *sqlmock.Rows
		firstQueryErr   error
		secondQueryErr  error
		expectedErr     error
	}{
		{
			name:            "fail convert clientId",
			clientId:        "ibc_client-id",
			firstQueryRows:  sqlmock.NewRows([]string{}),
			secondQueryRows: sqlmock.NewRows([]string{}),
			expectedErr:     fmt.Errorf("invalid syntax"),
		},
		{
			name:            "fail query ClientOrAuthHandlerUTxOs",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{}),
			secondQueryRows: sqlmock.NewRows([]string{}),
			firstQueryErr:   fmt.Errorf("query error"),
			expectedErr:     fmt.Errorf("query error"),
		},
		{
			name:            "query ClientOrAuthHandlerUTxOs dose not return any value",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{}),
			secondQueryRows: sqlmock.NewRows([]string{}),
			expectedErr:     fmt.Errorf("no utxos found for policyId"),
		},
		{
			name:            "query handlerUtxos's datum empty",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", nil, policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{}),
			expectedErr:     fmt.Errorf("datum is nil"),
		},
		{
			name:            "decode handler datum fail",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\x", policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{}),
			expectedErr:     fmt.Errorf("cbor: invalid additional"),
		},
		{
			name:            "fail query FindUtxosByPolicyIdAndPrefixTokenName",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", datumDecodeString, policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{}),
			secondQueryErr:  fmt.Errorf("query error"),
			expectedErr:     fmt.Errorf("query error"),
		},
		{
			name:            "query FindUtxosByPolicyIdAndPrefixTokenName dose not return any value",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", datumDecodeString, policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{}),
			expectedErr:     fmt.Errorf("no utxos found for policyId"),
		},
		{
			name:            "query clientUtxos's datum empty",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", datumDecodeString, policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", nil, policyIdDecodeString, "assets_name", 1, 1),
			expectedErr:     fmt.Errorf("datum is nil"),
		},
		{
			name:            "decode client datum fail",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", datumDecodeString, policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\x", policyIdDecodeString, "assets_name", 1, 1),
			expectedErr:     fmt.Errorf("EOF"),
		},
		{
			name:            "success",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", datumDecodeString, policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", "\\xd8799fd8799fd8799f4973696465636861696ed8799f0103ff1b0005795974ab80001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f001a00054016ff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffb818d8799f001a00052bdaffd8799f1b17e5b06d783201ce58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582039095cb1a45a8c10c8c9808402a690bd9e19934739540d2f3266ffa132ed160dffffd8799f001a00052c99ffd8799f1b17e5b09c92a65f1758201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820697de8555cab4cd5a78ef8c23baea3e3054c9c06a506ea6deeb0d8123447c287ffffd8799f001a00052dd8ffd8799f1b17e5b0ea71b2904f58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820b589ddf3182e5f4bf3c98a5f5002745c127ba5640c844c9ccff53c599286f56bffffd8799f001a00052ed7ffd8799f1b17e5b1296f948c7058201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c18d6f820883518e675d5135e19a02a3168d37757baa26e55c5fe0d5ef1d9c4effffd8799f001a00053031ffd8799f1b17e5b17db2245fc858201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582085dcbf989a764762d889165ed061abc017ff518d993714236a974ade659a0cbdffffd8799f001a000530f3ffd8799f1b17e5b1aed84a851858201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58209db53eaadc8eb8b0981568b02b110c863dc06074e74c92aa5290c3632df8b490ffffd8799f001a000531b9ffd8799f1b17e5b1df41515ebd58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582089b5325eac7a266a200f2735f7e767d4844eba770453ab53894512ae81ef05c6ffffd8799f001a0005332cffd8799f1b17e5b239f12d1f0758201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c2d185687e6e3b40a9d8123a524dd461397cf642270b22097f6e4c7bb0dabb62ffffd8799f001a000533aaffd8799f1b17e5b2590e0b07b458201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820778de6ce2e247597e7e742f92a1dbcb6ffc1f5217c7b07fe99580a56cbc2d860ffffd8799f001a000533d0ffd8799f1b17e5b2628ae799a158201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820036e1cc246b2a7baebb36a33fb6409b2bdf4babbcd692dc57fe2808f31b1b928ffffd8799f001a00053468ffd8799f1b17e5b288b783cacd58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58203baffd27bd267acd1f6d366b47b734d7504e86ffd909f29f826ed95439dc2521ffffd8799f001a000535eeffd8799f1b17e5b2e7e13f0ca358201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58205c123613e400f17c8609a89bbe4548e39f755ddd0e3621f3a510f6b2e9b1b304ffffd8799f001a0005369cffd8799f1b17e5b3127b8eb88158201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820cde97211bdd53ce67b179ddfbfa89be6b9d3aa4dd725c480e95465a6e5cce07dffffd8799f001a00053732ffd8799f1b17e5b33756e889d958201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582061e3e2ba215aa1eb3ca903632ce1743a222a007822d31fc3552a5d411140a36dffffd8799f001a000537ccffd8799f1b17e5b35ccf30cc7e58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58201c42f44e4638996b45307db8fd8cec0c6e3d4aad4a433ad3db968c11b77baf89ffffd8799f001a00053930ffd8799f1b17e5b3b432dddc8c58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820a4bcd1c51ff36aa94c0a9073ea90b901eefd49c23e98438ed99cfa71fece682bffffd8799f001a000539e8ffd8799f1b17e5b3e1c22fb66058201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820f240e7efb3127201802e1232a845fbeee27fe05a323a4e659a9f2f5faaa0b95fffffd8799f001a00053b23ffd8799f1b17e5b42f19e91bac58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820352cb6b89f71c20eac74eae16e6f4234c5c8eaed1dc9150482ed97902049df41ffffd8799f001a00053bd2ffd8799f1b17e5b45a4864b30558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58209a481f5153ecc266662989dbf14fa18c61dc42dc78b09518b1c8a2a49b46c911ffffd8799f001a00053ca3ffd8799f1b17e5b48d85b9115558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820489c9d659c5a4c5b73d721e47cc3f424d34812e16567c25830879ffb70ff27c2ffffd8799f001a00053de3ffd8799f1b17e5b4dc45a34bb558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58202d2ce832e17ff0494969c0aeb1d64bf52eac6fdb1213b6b6325c8adafffe22f7ffffd8799f001a00053f1affd8799f1b17e5b5285090d03b58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582061d02f3bf942447fb77a88e40a7e4d54d39d51c2908451b8b1cfcaa9df141a36ffffd8799f001a00053ffaffd8799f1b17e5b55efc1a6c1b58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582016657d75e8348b19a4f3c6d9c926b952ed830fea0aa6cff29aee019f806b591dffffd8799f001a00054016ffd8799f1b17e5b565f64ff8ba58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582039598d84b377e7db2a471752b9dae5ff9b6451794fb2a2ec2cb3fd1b56a0e0aeffffffd8799f581c13cd4d50ea648ba4572068250c6fa9a24c7284dfdbef6fa066541c6a581a14807575bdd0c3aa43547c44f70b3c0552b5cb66f2c9db643136ffff", policyIdDecodeString, "assets_name", 1, 1),
		},
	}

	for _, tc := range testCase {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbservice, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gateway := &Gateway{
				DBService: dbservice,
			}
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
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id`).
				WillReturnError(tc.firstQueryErr).
				WillReturnRows(tc.firstQueryRows)

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
				WillReturnError(tc.secondQueryErr).
				WillReturnRows(tc.secondQueryRows)

			clientDatum, spendClientUTXO, err := gateway.GetClientDatum(tc.clientId, 123)
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, clientDatum)
				require.NotEmpty(t, spendClientUTXO)
			}
		})

	}
}

func TestQueryClientState(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	chainHandler, err := helpers.GetChainHandler()
	require.NoError(t, err)
	policyIdDecodeString, err := hex.DecodeString(chainHandler.HandlerAuthToken.PolicyID)
	require.NoError(t, err)
	datumDecodeString, err := hex.DecodeString("d8799fd8799f00000080ffd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff")

	testCase := []struct {
		name            string
		clientId        string
		firstQueryRows  *sqlmock.Rows
		secondQueryRows *sqlmock.Rows
		firstQueryErr   error
		secondQueryErr  error
		httpStatus      int
		expectedErr     error
		returnData      string
	}{
		{
			name:            "fail query client datum",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", nil, policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", nil, policyIdDecodeString, "assets_name", 1, 1),
			expectedErr:     fmt.Errorf("datum is nil"),
		},
		{
			name:            "query mithril fail",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", datumDecodeString, policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799f4973696465636861696ed8799f0103ff1b0005795974ab80001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f001a00054016ff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffb818d8799f001a00052bdaffd8799f1b17e5b06d783201ce58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582039095cb1a45a8c10c8c9808402a690bd9e19934739540d2f3266ffa132ed160dffffd8799f001a00052c99ffd8799f1b17e5b09c92a65f1758201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820697de8555cab4cd5a78ef8c23baea3e3054c9c06a506ea6deeb0d8123447c287ffffd8799f001a00052dd8ffd8799f1b17e5b0ea71b2904f58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820b589ddf3182e5f4bf3c98a5f5002745c127ba5640c844c9ccff53c599286f56bffffd8799f001a00052ed7ffd8799f1b17e5b1296f948c7058201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c18d6f820883518e675d5135e19a02a3168d37757baa26e55c5fe0d5ef1d9c4effffd8799f001a00053031ffd8799f1b17e5b17db2245fc858201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582085dcbf989a764762d889165ed061abc017ff518d993714236a974ade659a0cbdffffd8799f001a000530f3ffd8799f1b17e5b1aed84a851858201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58209db53eaadc8eb8b0981568b02b110c863dc06074e74c92aa5290c3632df8b490ffffd8799f001a000531b9ffd8799f1b17e5b1df41515ebd58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582089b5325eac7a266a200f2735f7e767d4844eba770453ab53894512ae81ef05c6ffffd8799f001a0005332cffd8799f1b17e5b239f12d1f0758201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c2d185687e6e3b40a9d8123a524dd461397cf642270b22097f6e4c7bb0dabb62ffffd8799f001a000533aaffd8799f1b17e5b2590e0b07b458201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820778de6ce2e247597e7e742f92a1dbcb6ffc1f5217c7b07fe99580a56cbc2d860ffffd8799f001a000533d0ffd8799f1b17e5b2628ae799a158201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820036e1cc246b2a7baebb36a33fb6409b2bdf4babbcd692dc57fe2808f31b1b928ffffd8799f001a00053468ffd8799f1b17e5b288b783cacd58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58203baffd27bd267acd1f6d366b47b734d7504e86ffd909f29f826ed95439dc2521ffffd8799f001a000535eeffd8799f1b17e5b2e7e13f0ca358201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58205c123613e400f17c8609a89bbe4548e39f755ddd0e3621f3a510f6b2e9b1b304ffffd8799f001a0005369cffd8799f1b17e5b3127b8eb88158201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820cde97211bdd53ce67b179ddfbfa89be6b9d3aa4dd725c480e95465a6e5cce07dffffd8799f001a00053732ffd8799f1b17e5b33756e889d958201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582061e3e2ba215aa1eb3ca903632ce1743a222a007822d31fc3552a5d411140a36dffffd8799f001a000537ccffd8799f1b17e5b35ccf30cc7e58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58201c42f44e4638996b45307db8fd8cec0c6e3d4aad4a433ad3db968c11b77baf89ffffd8799f001a00053930ffd8799f1b17e5b3b432dddc8c58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820a4bcd1c51ff36aa94c0a9073ea90b901eefd49c23e98438ed99cfa71fece682bffffd8799f001a000539e8ffd8799f1b17e5b3e1c22fb66058201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820f240e7efb3127201802e1232a845fbeee27fe05a323a4e659a9f2f5faaa0b95fffffd8799f001a00053b23ffd8799f1b17e5b42f19e91bac58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820352cb6b89f71c20eac74eae16e6f4234c5c8eaed1dc9150482ed97902049df41ffffd8799f001a00053bd2ffd8799f1b17e5b45a4864b30558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58209a481f5153ecc266662989dbf14fa18c61dc42dc78b09518b1c8a2a49b46c911ffffd8799f001a00053ca3ffd8799f1b17e5b48d85b9115558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820489c9d659c5a4c5b73d721e47cc3f424d34812e16567c25830879ffb70ff27c2ffffd8799f001a00053de3ffd8799f1b17e5b4dc45a34bb558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58202d2ce832e17ff0494969c0aeb1d64bf52eac6fdb1213b6b6325c8adafffe22f7ffffd8799f001a00053f1affd8799f1b17e5b5285090d03b58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582061d02f3bf942447fb77a88e40a7e4d54d39d51c2908451b8b1cfcaa9df141a36ffffd8799f001a00053ffaffd8799f1b17e5b55efc1a6c1b58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582016657d75e8348b19a4f3c6d9c926b952ed830fea0aa6cff29aee019f806b591dffffd8799f001a00054016ffd8799f1b17e5b565f64ff8ba58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582039598d84b377e7db2a471752b9dae5ff9b6451794fb2a2ec2cb3fd1b56a0e0aeffffffd8799f581c13cd4d50ea648ba4572068250c6fa9a24c7284dfdbef6fa066541c6a581a14807575bdd0c3aa43547c44f70b3c0552b5cb66f2c9db643136ffff", policyIdDecodeString, "assets_name", 1, 1),
			httpStatus:      http.StatusBadRequest,
			returnData:      "[]",
			expectedErr:     fmt.Errorf("%v", http.StatusBadRequest),
		},
		{
			name:            "certified transactions is empty",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", datumDecodeString, policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799f4973696465636861696ed8799f0103ff1b0005795974ab80001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f001a00054016ff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffb818d8799f001a00052bdaffd8799f1b17e5b06d783201ce58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582039095cb1a45a8c10c8c9808402a690bd9e19934739540d2f3266ffa132ed160dffffd8799f001a00052c99ffd8799f1b17e5b09c92a65f1758201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820697de8555cab4cd5a78ef8c23baea3e3054c9c06a506ea6deeb0d8123447c287ffffd8799f001a00052dd8ffd8799f1b17e5b0ea71b2904f58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820b589ddf3182e5f4bf3c98a5f5002745c127ba5640c844c9ccff53c599286f56bffffd8799f001a00052ed7ffd8799f1b17e5b1296f948c7058201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c18d6f820883518e675d5135e19a02a3168d37757baa26e55c5fe0d5ef1d9c4effffd8799f001a00053031ffd8799f1b17e5b17db2245fc858201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582085dcbf989a764762d889165ed061abc017ff518d993714236a974ade659a0cbdffffd8799f001a000530f3ffd8799f1b17e5b1aed84a851858201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58209db53eaadc8eb8b0981568b02b110c863dc06074e74c92aa5290c3632df8b490ffffd8799f001a000531b9ffd8799f1b17e5b1df41515ebd58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582089b5325eac7a266a200f2735f7e767d4844eba770453ab53894512ae81ef05c6ffffd8799f001a0005332cffd8799f1b17e5b239f12d1f0758201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c2d185687e6e3b40a9d8123a524dd461397cf642270b22097f6e4c7bb0dabb62ffffd8799f001a000533aaffd8799f1b17e5b2590e0b07b458201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820778de6ce2e247597e7e742f92a1dbcb6ffc1f5217c7b07fe99580a56cbc2d860ffffd8799f001a000533d0ffd8799f1b17e5b2628ae799a158201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820036e1cc246b2a7baebb36a33fb6409b2bdf4babbcd692dc57fe2808f31b1b928ffffd8799f001a00053468ffd8799f1b17e5b288b783cacd58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58203baffd27bd267acd1f6d366b47b734d7504e86ffd909f29f826ed95439dc2521ffffd8799f001a000535eeffd8799f1b17e5b2e7e13f0ca358201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58205c123613e400f17c8609a89bbe4548e39f755ddd0e3621f3a510f6b2e9b1b304ffffd8799f001a0005369cffd8799f1b17e5b3127b8eb88158201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820cde97211bdd53ce67b179ddfbfa89be6b9d3aa4dd725c480e95465a6e5cce07dffffd8799f001a00053732ffd8799f1b17e5b33756e889d958201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582061e3e2ba215aa1eb3ca903632ce1743a222a007822d31fc3552a5d411140a36dffffd8799f001a000537ccffd8799f1b17e5b35ccf30cc7e58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58201c42f44e4638996b45307db8fd8cec0c6e3d4aad4a433ad3db968c11b77baf89ffffd8799f001a00053930ffd8799f1b17e5b3b432dddc8c58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820a4bcd1c51ff36aa94c0a9073ea90b901eefd49c23e98438ed99cfa71fece682bffffd8799f001a000539e8ffd8799f1b17e5b3e1c22fb66058201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820f240e7efb3127201802e1232a845fbeee27fe05a323a4e659a9f2f5faaa0b95fffffd8799f001a00053b23ffd8799f1b17e5b42f19e91bac58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820352cb6b89f71c20eac74eae16e6f4234c5c8eaed1dc9150482ed97902049df41ffffd8799f001a00053bd2ffd8799f1b17e5b45a4864b30558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58209a481f5153ecc266662989dbf14fa18c61dc42dc78b09518b1c8a2a49b46c911ffffd8799f001a00053ca3ffd8799f1b17e5b48d85b9115558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820489c9d659c5a4c5b73d721e47cc3f424d34812e16567c25830879ffb70ff27c2ffffd8799f001a00053de3ffd8799f1b17e5b4dc45a34bb558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58202d2ce832e17ff0494969c0aeb1d64bf52eac6fdb1213b6b6325c8adafffe22f7ffffd8799f001a00053f1affd8799f1b17e5b5285090d03b58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582061d02f3bf942447fb77a88e40a7e4d54d39d51c2908451b8b1cfcaa9df141a36ffffd8799f001a00053ffaffd8799f1b17e5b55efc1a6c1b58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582016657d75e8348b19a4f3c6d9c926b952ed830fea0aa6cff29aee019f806b591dffffd8799f001a00054016ffd8799f1b17e5b565f64ff8ba58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582039598d84b377e7db2a471752b9dae5ff9b6451794fb2a2ec2cb3fd1b56a0e0aeffffffd8799f581c13cd4d50ea648ba4572068250c6fa9a24c7284dfdbef6fa066541c6a581a14807575bdd0c3aa43547c44f70b3c0552b5cb66f2c9db643136ffff", policyIdDecodeString, "assets_name", 1, 1),
			httpStatus:      http.StatusOK,
			returnData:      "[]",
			expectedErr:     fmt.Errorf("no certified transactions with proof found for client"),
		},
		{
			name:            "success",
			clientId:        "ibc_client-1",
			firstQueryRows:  sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "tx_hash", 1, 1, "datum_hash", datumDecodeString, policyIdDecodeString, "assets_name", 1, 1),
			secondQueryRows: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799f4973696465636861696ed8799f0103ff1b0005795974ab80001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f001a00054016ff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffb818d8799f001a00052bdaffd8799f1b17e5b06d783201ce58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582039095cb1a45a8c10c8c9808402a690bd9e19934739540d2f3266ffa132ed160dffffd8799f001a00052c99ffd8799f1b17e5b09c92a65f1758201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820697de8555cab4cd5a78ef8c23baea3e3054c9c06a506ea6deeb0d8123447c287ffffd8799f001a00052dd8ffd8799f1b17e5b0ea71b2904f58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820b589ddf3182e5f4bf3c98a5f5002745c127ba5640c844c9ccff53c599286f56bffffd8799f001a00052ed7ffd8799f1b17e5b1296f948c7058201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c18d6f820883518e675d5135e19a02a3168d37757baa26e55c5fe0d5ef1d9c4effffd8799f001a00053031ffd8799f1b17e5b17db2245fc858201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582085dcbf989a764762d889165ed061abc017ff518d993714236a974ade659a0cbdffffd8799f001a000530f3ffd8799f1b17e5b1aed84a851858201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58209db53eaadc8eb8b0981568b02b110c863dc06074e74c92aa5290c3632df8b490ffffd8799f001a000531b9ffd8799f1b17e5b1df41515ebd58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582089b5325eac7a266a200f2735f7e767d4844eba770453ab53894512ae81ef05c6ffffd8799f001a0005332cffd8799f1b17e5b239f12d1f0758201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c2d185687e6e3b40a9d8123a524dd461397cf642270b22097f6e4c7bb0dabb62ffffd8799f001a000533aaffd8799f1b17e5b2590e0b07b458201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820778de6ce2e247597e7e742f92a1dbcb6ffc1f5217c7b07fe99580a56cbc2d860ffffd8799f001a000533d0ffd8799f1b17e5b2628ae799a158201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820036e1cc246b2a7baebb36a33fb6409b2bdf4babbcd692dc57fe2808f31b1b928ffffd8799f001a00053468ffd8799f1b17e5b288b783cacd58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58203baffd27bd267acd1f6d366b47b734d7504e86ffd909f29f826ed95439dc2521ffffd8799f001a000535eeffd8799f1b17e5b2e7e13f0ca358201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58205c123613e400f17c8609a89bbe4548e39f755ddd0e3621f3a510f6b2e9b1b304ffffd8799f001a0005369cffd8799f1b17e5b3127b8eb88158201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820cde97211bdd53ce67b179ddfbfa89be6b9d3aa4dd725c480e95465a6e5cce07dffffd8799f001a00053732ffd8799f1b17e5b33756e889d958201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582061e3e2ba215aa1eb3ca903632ce1743a222a007822d31fc3552a5d411140a36dffffd8799f001a000537ccffd8799f1b17e5b35ccf30cc7e58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58201c42f44e4638996b45307db8fd8cec0c6e3d4aad4a433ad3db968c11b77baf89ffffd8799f001a00053930ffd8799f1b17e5b3b432dddc8c58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820a4bcd1c51ff36aa94c0a9073ea90b901eefd49c23e98438ed99cfa71fece682bffffd8799f001a000539e8ffd8799f1b17e5b3e1c22fb66058201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820f240e7efb3127201802e1232a845fbeee27fe05a323a4e659a9f2f5faaa0b95fffffd8799f001a00053b23ffd8799f1b17e5b42f19e91bac58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820352cb6b89f71c20eac74eae16e6f4234c5c8eaed1dc9150482ed97902049df41ffffd8799f001a00053bd2ffd8799f1b17e5b45a4864b30558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58209a481f5153ecc266662989dbf14fa18c61dc42dc78b09518b1c8a2a49b46c911ffffd8799f001a00053ca3ffd8799f1b17e5b48d85b9115558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820489c9d659c5a4c5b73d721e47cc3f424d34812e16567c25830879ffb70ff27c2ffffd8799f001a00053de3ffd8799f1b17e5b4dc45a34bb558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f58202d2ce832e17ff0494969c0aeb1d64bf52eac6fdb1213b6b6325c8adafffe22f7ffffd8799f001a00053f1affd8799f1b17e5b5285090d03b58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582061d02f3bf942447fb77a88e40a7e4d54d39d51c2908451b8b1cfcaa9df141a36ffffd8799f001a00053ffaffd8799f1b17e5b55efc1a6c1b58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582016657d75e8348b19a4f3c6d9c926b952ed830fea0aa6cff29aee019f806b591dffffd8799f001a00054016ffd8799f1b17e5b565f64ff8ba58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f582039598d84b377e7db2a471752b9dae5ff9b6451794fb2a2ec2cb3fd1b56a0e0aeffffffd8799f581c13cd4d50ea648ba4572068250c6fa9a24c7284dfdbef6fa066541c6a581a14807575bdd0c3aa43547c44f70b3c0552b5cb66f2c9db643136ffff", policyIdDecodeString, "assets_name", 1, 1),
			httpStatus:      http.StatusOK,
			returnData:      "[{\"transactions_hashes\":[\"89a81febe6c19bbf5ce26d96530c70b811623df73296cf03f033cffb830fbec9\"],\"proof\":\"proof value\"}]",
		},
	}

	for _, tc := range testCase {

		t.Run(tc.name, func(t *testing.T) {
			dbservice, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gateway := &Gateway{
				MithrilService: mithrilpacket.NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator"),
				DBService:      dbservice,
			}
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
      INNER JOIN block AS generating_block on generating_block.id = generating_tx.block_id`).
				WillReturnError(tc.firstQueryErr).
				WillReturnRows(tc.firstQueryRows)

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

			clientStateRes, proof, proofHeight, err := gateway.QueryClientState(tc.clientId, 123)
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, clientStateRes)
				require.NotEmpty(t, proof)
				require.NotEmpty(t, proofHeight)
			}
		})
	}
}

func TestQueryIBCGenesisCertHeader(t *testing.T) {
	testCases := []struct {
		name         string
		queryStatus1 int
		queryStatus2 int
		queryStatus3 int
		queryStatus4 int
		queryEpoch   int64
		returnEpoch  int
		expectedErr  error
	}{
		{
			name:         "fail to get GetListMithrilStakeDistributions",
			queryStatus1: http.StatusBadRequest,
			returnEpoch:  640,
			expectedErr:  fmt.Errorf("400"),
		},
		{
			name:         "Could not find stake distribution with epoch",
			queryStatus1: http.StatusOK,
			queryEpoch:   641,
			returnEpoch:  640,
			expectedErr:  fmt.Errorf("Could not find stake distribution with epoch"),
		},

		{
			name:         "fail to GetCertificateByHash mithrilStakeDistribution.CertificateHash",
			queryStatus1: http.StatusOK,
			queryEpoch:   640,
			returnEpoch:  640,
			queryStatus2: http.StatusBadRequest,
			expectedErr:  fmt.Errorf("400"),
		},

		{
			name:         "fail to GetCardanoTransactionsSetSnapshot",
			queryStatus1: http.StatusOK,
			queryEpoch:   640,
			returnEpoch:  640,
			queryStatus2: http.StatusOK,
			queryStatus3: http.StatusBadRequest,
			expectedErr:  fmt.Errorf("400"),
		},
		{
			name:         "Could not find snapshot with epoch",
			queryStatus1: http.StatusOK,
			queryEpoch:   641,
			returnEpoch:  641,
			queryStatus2: http.StatusOK,
			queryStatus3: http.StatusOK,
			expectedErr:  fmt.Errorf("Could not find snapshot with epoch"),
		},
		{
			name:         "success",
			queryStatus1: http.StatusOK,
			queryEpoch:   640,
			returnEpoch:  640,
			queryStatus2: http.StatusOK,
			queryStatus3: http.StatusOK,
			queryStatus4: http.StatusOK,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			gw := &Gateway{}
			mithrilService := mithrilservice.NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
			gw.MithrilService = mithrilService

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/artifact/mithril-stake-distributions").
				Reply(tc.queryStatus1).
				JSON(fmt.Sprintf("[{\"epoch\":%v,\"hash\":\"fbbe55ca0230d515b1d67e5301f386ac51dc7273488cad3b7d73a0a80acb0f87\",\"certificate_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"created_at\":\"2024-07-26T00:06:03.543232456Z\"},{\"epoch\":638,\"hash\":\"a0c9f58f4f7b94c1583f7456bece2fd3153286275f92eec4dbac36c8ed95fb60\",\"certificate_hash\":\"9a767bd7456ba4713db9f187a912d1dcb1ba94ee153636161503f3ee0ee437ee\",\"created_at\":\"2024-07-24T00:06:30.492172869Z\"}]", tc.returnEpoch))

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/certificate/12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45").
				Reply(tc.queryStatus2).
				JSON("{\"hash\":\"941afe90ebe96b603bddfea7fd1ab246cf9e69c9c873548128369c828858b751\",\"previous_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"epoch\":640,\"signed_entity_type\":{\"CardanoTransactions\":[640,2324579]},\"beacon\":{\"network\":\"preview\",\"epoch\":640,\"immutable_file_number\":12801},\"metadata\":{\"network\":\"preview\",\"version\":\"0.1.0\",\"parameters\":{\"k\":2422,\"m\":20973,\"phi_f\":0.2},\"initiated_at\":\"2024-07-26T06:46:56.178599138Z\",\"sealed_at\":\"2024-07-26T06:49:56.736675144Z\",\"signers\":[{\"party_id\":\"pool1r0tln8nct3mpyvehgy6uu3cdlmjnmtr2fxjcqnfl6v0qg0we42e\",\"stake\":9497629046},{\"party_id\":\"pool1t9uuagsat8hlr0n0ga4wzge0jxlyjuhl6mugrm8atc285vzkf2e\",\"stake\":9497629046},{\"party_id\":\"pool1vapqexnsx6hvc588yyysxpjecf3k43hcr5mvhmstutuvy085xpa\",\"stake\":9497432569}]},\"protocol_message\":{\"message_parts\":{\"cardano_transactions_merkle_root\":\"1fbe314bd9fe5627f10de40d6d1a0a386e91885716c789ca1b7e89a18309d4d3\",\"next_aggregate_verification_key\":\"7b226d745f636f6d6d69746d656e74223a7b22726f6f74223a5b36312c3230312c36312c3230312c3136392c35342c3234372c33362c3138392c3137372c33332c3139382c3230312c3137302c362c39312c3137372c39342c3235312c3230342c3235342c3132362c3135372c3134342c302c342c32302c3233322c33322c3139362c3135332c32305d2c226e725f6c6561766573223a332c22686173686572223a6e756c6c7d2c22746f74616c5f7374616b65223a32383439323639303636317d\",\"latest_block_number\":\"2324579\"}},\"signed_message\":\"d322517bea19aac3026c896c356ef34aa6b65c29c7c49f1737811c3c5f5cf27a\",\"aggregate_verification_key\":\"7b226d745f636f6d6d69746d656e74223a7b22726f6f74223a5b35352c36342c3234382c3231312c3132342c3137342c3230372c3230382c3135342c3230322c3233352c31352c35362c34382c38352c3138372c3230322c3235312c35382c3133342c31362c3130382c3137352c3137392c3138302c39332c3130382c31372c38362c37302c35332c3138375d2c226e725f6c6561766573223a332c22686173686572223a6e756c6c7d2c22746f74616c5f7374616b65223a32383439323639303636317d\",\"multi_signature\":\"\",\"genesis_signature\":\"\"}")

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/artifact/cardano-transactions").
				Reply(tc.queryStatus3).
				JSON("[{\"merkle_root\":\"f0ee0e2015a501de781d9a22f2baa360f723e0b07688668ab361b89eab9a5ce3\",\"epoch\":640,\"block_number\":2324609,\"hash\":\"75144521b1886c197ebdfdfe1119d89ea04d8f0b70096b70109d3647290df518\",\"certificate_hash\":\"bdf6a5f4e0d3731f482e984966f8456daa4dcf1d07992f3f21dac30e3c41a963\",\"created_at\":\"2024-07-26T07:00:17.954696409Z\"},{\"merkle_root\":\"1fbe314bd9fe5627f10de40d6d1a0a386e91885716c789ca1b7e89a18309d4d3\",\"epoch\":640,\"block_number\":2324579,\"hash\":\"9ba7c113477696cad8cecc75d36ccb18993e96c99af94862ad0a6a65c7e54005\",\"certificate_hash\":\"941afe90ebe96b603bddfea7fd1ab246cf9e69c9c873548128369c828858b751\",\"created_at\":\"2024-07-26T06:49:58.944499120Z\"}]")

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/certificate/941afe90ebe96b603bddfea7fd1ab246cf9e69c9c873548128369c828858b751").
				Reply(tc.queryStatus4).
				JSON("{\"hash\":\"941afe90ebe96b603bddfea7fd1ab246cf9e69c9c873548128369c828858b751\",\"previous_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"epoch\":640,\"signed_entity_type\":{\"CardanoTransactions\":[640,2324579]},\"beacon\":{\"network\":\"preview\",\"epoch\":640,\"immutable_file_number\":12801},\"metadata\":{\"network\":\"preview\",\"version\":\"0.1.0\",\"parameters\":{\"k\":2422,\"m\":20973,\"phi_f\":0.2},\"initiated_at\":\"2024-07-26T06:46:56.178599138Z\",\"sealed_at\":\"2024-07-26T06:49:56.736675144Z\",\"signers\":[{\"party_id\":\"pool1r0tln8nct3mpyvehgy6uu3cdlmjnmtr2fxjcqnfl6v0qg0we42e\",\"stake\":9497629046},{\"party_id\":\"pool1t9uuagsat8hlr0n0ga4wzge0jxlyjuhl6mugrm8atc285vzkf2e\",\"stake\":9497629046},{\"party_id\":\"pool1vapqexnsx6hvc588yyysxpjecf3k43hcr5mvhmstutuvy085xpa\",\"stake\":9497432569}]},\"protocol_message\":{\"message_parts\":{\"cardano_transactions_merkle_root\":\"1fbe314bd9fe5627f10de40d6d1a0a386e91885716c789ca1b7e89a18309d4d3\",\"next_aggregate_verification_key\":\"7b226d745f636f6d6d69746d656e74223a7b22726f6f74223a5b36312c3230312c36312c3230312c3136392c35342c3234372c33362c3138392c3137372c33332c3139382c3230312c3137302c362c39312c3137372c39342c3235312c3230342c3235342c3132362c3135372c3134342c302c342c32302c3233322c33322c3139362c3135332c32305d2c226e725f6c6561766573223a332c22686173686572223a6e756c6c7d2c22746f74616c5f7374616b65223a32383439323639303636317d\",\"latest_block_number\":\"2324579\"}},\"signed_message\":\"d322517bea19aac3026c896c356ef34aa6b65c29c7c49f1737811c3c5f5cf27a\",\"aggregate_verification_key\":\"7b226d745f636f6d6d69746d656e74223a7b22726f6f74223a5b35352c36342c3234382c3231312c3132342c3137342c3230372c3230382c3135342c3230322c3233352c31352c35362c34382c38352c3138372c3230322c3235312c35382c3133342c31362c3130382c3137352c3137392c3138302c39332c3130382c31372c38362c37302c35332c3138375d2c226e725f6c6561766573223a332c22686173686572223a6e756c6c7d2c22746f74616c5f7374616b65223a32383439323639303636317d\",\"multi_signature\":\"\",\"genesis_signature\":\"\"}")
			defer gock.Off()
			response, err := gw.QueryIBCGenesisCertHeader(context.Background(), tc.queryEpoch)
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryNewMithrilClient(t *testing.T) {
	testCases := []struct {
		name         string
		queryStatus  int
		queryStatus1 int
		queryStatus2 int
		queryStatus3 int
		queryStatus4 int
		returnData1  string
		returnData3  int
		returnData4  string
		expectedErr  error
	}{
		{
			name:        "fail to GetEpochSetting",
			queryStatus: http.StatusBadRequest,
			expectedErr: fmt.Errorf("400"),
		},
		{
			name:         "fail to GetListMithrilStakeDistributions",
			queryStatus:  http.StatusOK,
			queryStatus1: http.StatusBadRequest,
			expectedErr:  fmt.Errorf("400"),
		},
		{
			name:         "GetListMithrilStakeDistributions returned empty list",
			queryStatus:  http.StatusOK,
			queryStatus1: http.StatusOK,
			returnData1:  "[]",
			expectedErr:  fmt.Errorf("GetListMithrilStakeDistributions returned empty list"),
		},
		{
			name:         "fail to GetCertificateByHash",
			queryStatus:  http.StatusOK,
			queryStatus1: http.StatusOK,
			queryStatus2: http.StatusBadRequest,
			returnData1:  "[{\"epoch\":640,\"hash\":\"fbbe55ca0230d515b1d67e5301f386ac51dc7273488cad3b7d73a0a80acb0f87\",\"certificate_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"created_at\":\"2024-07-26T00:06:03.543232456Z\"},{\"epoch\":638,\"hash\":\"a0c9f58f4f7b94c1583f7456bece2fd3153286275f92eec4dbac36c8ed95fb60\",\"certificate_hash\":\"9a767bd7456ba4713db9f187a912d1dcb1ba94ee153636161503f3ee0ee437ee\",\"created_at\":\"2024-07-24T00:06:30.492172869Z\"}]",
			expectedErr:  fmt.Errorf("400"),
		},
		{
			name:         "fail to GetListCertificates",
			queryStatus:  http.StatusOK,
			queryStatus1: http.StatusOK,
			queryStatus2: http.StatusOK,
			queryStatus3: http.StatusBadRequest,
			returnData1:  "[{\"epoch\":640,\"hash\":\"fbbe55ca0230d515b1d67e5301f386ac51dc7273488cad3b7d73a0a80acb0f87\",\"certificate_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"created_at\":\"2024-07-26T00:06:03.543232456Z\"},{\"epoch\":638,\"hash\":\"a0c9f58f4f7b94c1583f7456bece2fd3153286275f92eec4dbac36c8ed95fb60\",\"certificate_hash\":\"9a767bd7456ba4713db9f187a912d1dcb1ba94ee153636161503f3ee0ee437ee\",\"created_at\":\"2024-07-24T00:06:30.492172869Z\"}]",
			expectedErr:  fmt.Errorf("400"),
		},
		{
			name:         "could not find certificate with epoch",
			queryStatus:  http.StatusOK,
			queryStatus1: http.StatusOK,
			queryStatus2: http.StatusOK,
			queryStatus3: http.StatusOK,
			returnData1:  "[{\"epoch\":640,\"hash\":\"fbbe55ca0230d515b1d67e5301f386ac51dc7273488cad3b7d73a0a80acb0f87\",\"certificate_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"created_at\":\"2024-07-26T00:06:03.543232456Z\"},{\"epoch\":638,\"hash\":\"a0c9f58f4f7b94c1583f7456bece2fd3153286275f92eec4dbac36c8ed95fb60\",\"certificate_hash\":\"9a767bd7456ba4713db9f187a912d1dcb1ba94ee153636161503f3ee0ee437ee\",\"created_at\":\"2024-07-24T00:06:30.492172869Z\"}]",
			returnData3:  634,
			expectedErr:  fmt.Errorf("could not find certificate with epoch"),
		},
		{
			name:         "fail to GetCardanoTransactionsSetSnapshot",
			queryStatus:  http.StatusOK,
			queryStatus1: http.StatusOK,
			queryStatus2: http.StatusOK,
			queryStatus3: http.StatusOK,
			queryStatus4: http.StatusBadRequest,
			returnData1:  "[{\"epoch\":640,\"hash\":\"fbbe55ca0230d515b1d67e5301f386ac51dc7273488cad3b7d73a0a80acb0f87\",\"certificate_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"created_at\":\"2024-07-26T00:06:03.543232456Z\"},{\"epoch\":638,\"hash\":\"a0c9f58f4f7b94c1583f7456bece2fd3153286275f92eec4dbac36c8ed95fb60\",\"certificate_hash\":\"9a767bd7456ba4713db9f187a912d1dcb1ba94ee153636161503f3ee0ee437ee\",\"created_at\":\"2024-07-24T00:06:30.492172869Z\"}]",
			returnData3:  640,
			expectedErr:  fmt.Errorf("400"),
		},
		{
			name:         "GetListSnapshots returned empty list",
			queryStatus:  http.StatusOK,
			queryStatus1: http.StatusOK,
			queryStatus2: http.StatusOK,
			queryStatus3: http.StatusOK,
			queryStatus4: http.StatusOK,
			returnData1:  "[{\"epoch\":640,\"hash\":\"fbbe55ca0230d515b1d67e5301f386ac51dc7273488cad3b7d73a0a80acb0f87\",\"certificate_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"created_at\":\"2024-07-26T00:06:03.543232456Z\"},{\"epoch\":638,\"hash\":\"a0c9f58f4f7b94c1583f7456bece2fd3153286275f92eec4dbac36c8ed95fb60\",\"certificate_hash\":\"9a767bd7456ba4713db9f187a912d1dcb1ba94ee153636161503f3ee0ee437ee\",\"created_at\":\"2024-07-24T00:06:30.492172869Z\"}]",
			returnData3:  640,
			returnData4:  "[]",
			expectedErr:  fmt.Errorf("GetListSnapshots returned empty list"),
		},
		{
			name:         "success",
			queryStatus:  http.StatusOK,
			queryStatus1: http.StatusOK,
			queryStatus2: http.StatusOK,
			queryStatus3: http.StatusOK,
			queryStatus4: http.StatusOK,
			returnData1:  "[{\"epoch\":640,\"hash\":\"fbbe55ca0230d515b1d67e5301f386ac51dc7273488cad3b7d73a0a80acb0f87\",\"certificate_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"created_at\":\"2024-07-26T00:06:03.543232456Z\"},{\"epoch\":638,\"hash\":\"a0c9f58f4f7b94c1583f7456bece2fd3153286275f92eec4dbac36c8ed95fb60\",\"certificate_hash\":\"9a767bd7456ba4713db9f187a912d1dcb1ba94ee153636161503f3ee0ee437ee\",\"created_at\":\"2024-07-24T00:06:30.492172869Z\"}]",
			returnData3:  640,
			returnData4:  "[{\"merkle_root\":\"f0ee0e2015a501de781d9a22f2baa360f723e0b07688668ab361b89eab9a5ce3\",\"epoch\":640,\"block_number\":2324609,\"hash\":\"75144521b1886c197ebdfdfe1119d89ea04d8f0b70096b70109d3647290df518\",\"certificate_hash\":\"bdf6a5f4e0d3731f482e984966f8456daa4dcf1d07992f3f21dac30e3c41a963\",\"created_at\":\"2024-07-26T07:00:17.954696409Z\"},{\"merkle_root\":\"1fbe314bd9fe5627f10de40d6d1a0a386e91885716c789ca1b7e89a18309d4d3\",\"epoch\":640,\"block_number\":2324579,\"hash\":\"9ba7c113477696cad8cecc75d36ccb18993e96c99af94862ad0a6a65c7e54005\",\"certificate_hash\":\"941afe90ebe96b603bddfea7fd1ab246cf9e69c9c873548128369c828858b751\",\"created_at\":\"2024-07-26T06:49:58.944499120Z\"}]",
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			gw := &Gateway{}
			mithrilService := mithrilservice.NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
			gw.MithrilService = mithrilService

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/epoch-settings").
				Reply(tc.queryStatus).
				JSON("{\"epoch\":643,\"protocol\":{\"k\":2422,\"m\":20973,\"phi_f\":0.2},\"next_protocol\":{\"k\":2422,\"m\":20973,\"phi_f\":0.2}}")

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/artifact/mithril-stake-distributions").
				Reply(tc.queryStatus1).
				JSON(tc.returnData1)

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/certificate/12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45").
				Reply(tc.queryStatus2).
				JSON("{\"hash\":\"941afe90ebe96b603bddfea7fd1ab246cf9e69c9c873548128369c828858b751\",\"previous_hash\":\"12b24890b635cacc37586b7e1a81914041306b5f002167df5a639c4c265c8e45\",\"epoch\":640,\"signed_entity_type\":{\"CardanoTransactions\":[640,2324579]},\"beacon\":{\"network\":\"preview\",\"epoch\":640,\"immutable_file_number\":12801},\"metadata\":{\"network\":\"preview\",\"version\":\"0.1.0\",\"parameters\":{\"k\":2422,\"m\":20973,\"phi_f\":0.2},\"initiated_at\":\"2024-07-26T06:46:56.178599138Z\",\"sealed_at\":\"2024-07-26T06:49:56.736675144Z\",\"signers\":[{\"party_id\":\"pool1r0tln8nct3mpyvehgy6uu3cdlmjnmtr2fxjcqnfl6v0qg0we42e\",\"stake\":9497629046},{\"party_id\":\"pool1t9uuagsat8hlr0n0ga4wzge0jxlyjuhl6mugrm8atc285vzkf2e\",\"stake\":9497629046},{\"party_id\":\"pool1vapqexnsx6hvc588yyysxpjecf3k43hcr5mvhmstutuvy085xpa\",\"stake\":9497432569}]},\"protocol_message\":{\"message_parts\":{\"cardano_transactions_merkle_root\":\"1fbe314bd9fe5627f10de40d6d1a0a386e91885716c789ca1b7e89a18309d4d3\",\"next_aggregate_verification_key\":\"7b226d745f636f6d6d69746d656e74223a7b22726f6f74223a5b36312c3230312c36312c3230312c3136392c35342c3234372c33362c3138392c3137372c33332c3139382c3230312c3137302c362c39312c3137372c39342c3235312c3230342c3235342c3132362c3135372c3134342c302c342c32302c3233322c33322c3139362c3135332c32305d2c226e725f6c6561766573223a332c22686173686572223a6e756c6c7d2c22746f74616c5f7374616b65223a32383439323639303636317d\",\"latest_block_number\":\"2324579\"}},\"signed_message\":\"d322517bea19aac3026c896c356ef34aa6b65c29c7c49f1737811c3c5f5cf27a\",\"aggregate_verification_key\":\"7b226d745f636f6d6d69746d656e74223a7b22726f6f74223a5b35352c36342c3234382c3231312c3132342c3137342c3230372c3230382c3135342c3230322c3233352c31352c35362c34382c38352c3138372c3230322c3235312c35382c3133342c31362c3130382c3137352c3137392c3138302c39332c3130382c31372c38362c37302c35332c3138375d2c226e725f6c6561766573223a332c22686173686572223a6e756c6c7d2c22746f74616c5f7374616b65223a32383439323639303636317d\",\"multi_signature\":\"\",\"genesis_signature\":\"\"}")

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/certificates").
				Reply(tc.queryStatus3).
				JSON(fmt.Sprintf("[{\"hash\":\"446e0f4f6971fc4308d4f4119bd029f1b48fa0c200211cca2cd6192d27bcc296\",\"previous_hash\":\"1f28b47b609289c6920423d9b756f654b3d77d26081c76380e5174f9ea0c0c01\",\"epoch\":%v,\"signed_entity_type\":{\"CardanoTransactions\":[643,2333879]},\"beacon\":{\"network\":\"preview\",\"epoch\":%v,\"immutable_file_number\":12858},\"metadata\":{\"network\":\"preview\",\"version\":\"0.1.0\",\"parameters\":{\"k\":2422,\"m\":20973,\"phi_f\":0.2},\"initiated_at\":\"2024-07-29T02:44:00.475731465Z\",\"sealed_at\":\"2024-07-29T02:47:00.939448323Z\",\"total_signers\":2},\"protocol_message\":{\"message_parts\":{\"cardano_transactions_merkle_root\":\"\",\"next_aggregate_verification_key\":\"\",\"latest_block_number\":\"2333879\"}},\"signed_message\":\"\",\"aggregate_verification_key\":\"\"}]", tc.returnData3, tc.returnData3))

			gock.New("https://aggregator.testing-preview.api.mithril.network/aggregator").
				Get("/artifact/cardano-transactions").
				Reply(tc.queryStatus4).
				JSON(tc.returnData4)

			defer gock.Off()

			response1, response2, err := gw.QueryNewMithrilClient()
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response1)
				require.NotEmpty(t, response2)
			}
		})
	}
}

func TestUnmarshalConnectionEvent(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	testCases := []struct {
		name         string
		requestDatum string
		rowData      []string
		rows         *sqlmock.Rows
		expectedErr  error
		queryErr     error
	}{
		{
			name:         "fail to DecodeConnectionDatumSchema",
			requestDatum: "",
			rows:         sqlmock.NewRows([]string{"data", "type"}).AddRow("d8799fd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff", "mint"),
			expectedErr:  fmt.Errorf("EOF"),
		},
		{
			name:         "fail to query redeemer connection",
			requestDatum: "d8799fd8799f4c6962635f636c69656e742d309fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3040d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3030ffff",
			rows:         sqlmock.NewRows([]string{"data", "type"}).AddRow("d8799fd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff", "mint"),
			queryErr:     fmt.Errorf("not found"),
			expectedErr:  fmt.Errorf("not found"),
		},
		{
			name:         "success connection open init",
			requestDatum: "d8799fd8799f4c6962635f636c69656e742d309fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3040d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3030ffff",
			rowData:      []string{"d8799fd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff", "mint"},
			rows:         sqlmock.NewRows([]string{"data", "type"}),
		},
		{
			name:         "success connection open ack",
			requestDatum: "d8799fd8799f4c6962635f636c69656e742d309fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3040d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3030ffff",
			rowData:      []string{"d8799fd8799f423432d8799fd8799f00190b13ffffd8799fd8799f0000ffff0d1b000188e6d68b0000d8799fd8799f051864d8799fd8799f1114ffffffff80ffd8799f9fd8799fd8799fd8799f5818636f6e6e656374696f6e732f636f6e6e656374696f6e2d305f58400a16323030302d63617264616e6f2d6d69746872696c2d3012230a0131120d4f524445525f4f524445524544120f4f524445525f554e4f5244455245441802225824230a0c6962635f636c69656e742d30120c636f6e6e656374696f6e2d301a050a03696263ffd8799f01000101450002e8a601ff9fd8799f0158270204e8a6012067b76c7b82d60ebee7f41dd11a02534c1a16efa70c217310356230dfd5ad0c202040ffd8799f01460406e8a6012058212075c4910f51207d3c65960120fe931f138e2624668d75869f51b8442593dd5eabffd8799f0146060ce8a60120582120d85128294d1d08a117c0d23df9913b277a2d99d92f0527dfe94e1e8e32a668bfffd8799f0158270a1ee8a60120eb90941629e3e7c02e03a781ec620f088ebf55f0ada1af7fabbfaa632c0171e72040ffd8799f0158270c34e8a60120096828776b868138b9c46e09dc7fcc0073e25bac9770392b31779b8b8a15f6642040ffd8799f0158270e58e8a60120504b2e25929bc8d06af8fd88524b504f3c3fa414f2842e773c64833f2667da932040ffffffffffd8799fd8799fd8799f4369626358203c921bdfe7aa71b8f2444b3eef65ece4e1b984673921e2ca971689b249b0fd59d8799f010001014100ff9fd8799f0158210106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f40ffd8799f0141015820f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc48ffd8799f0158210124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed40ffd8799f01582101b616625d53c93aca36bf2c7840fd9df077a01efbcf88be1a8a1f1561f1047db940ffd8799f0141015820a5e9b730efe383260c8ee5520cae086ac8b1b519d2d4b8daef0b17c916e58a0affffffffffffffd8799f9fd8799fd8799fd8799f582a636c69656e74732f323030302d63617264616e6f2d6d69746872696c2d302f636c69656e7453746174655f58400a232f6962632e636c69656e74732e6d69746872696c2e76312e436c69656e745374617465121f0a02343212031093161a00200d2a040880af1a320a08051064461a0408111014ffd8799f01000101450002e6a601ff9fd8799f01460204e8a60120582120a9ed532c6970a7b2de172959612985b168405f54560db58da7905f02ef19c59dffd8799f0158270408e8a6012097b9eaa7fa0c5077e2e187247aa3b7bcbdf470103b91349e38f60f1a8dcefa392040ffd8799f0146060ce8a60120582120a2fe2b4bf88cde8e23303186e85f0afe255b6979dd8257cea0fc0cd628ca2b2cffd8799f0158270814e8a601200bade3437e1a84a7af2545e5f358b7b071532926482a2498102a030baea9b3eb2040ffd8799f01460a24e8a60120582120e3375681bf463f39c7f5db5645a11afecb0b11cf9aec9a4929a3e069e1fe041affd8799f01460e58e8a6012058212074aab51c75eb26e4c033d3b33e4b861d7874f649f483c458032a73219af4ca22ffffffffffd8799fd8799fd8799f4369626358203c921bdfe7aa71b8f2444b3eef65ece4e1b984673921e2ca971689b249b0fd59d8799f010001014100ff9fd8799f0158210106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f40ffd8799f0141015820f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc48ffd8799f0158210124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed40ffd8799f01582101b616625d53c93aca36bf2c7840fd9df077a01efbcf88be1a8a1f1561f1047db940ffd8799f0141015820a5e9b730efe383260c8ee5520cae086ac8b1b519d2d4b8daef0b17c916e58a0affffffffffffffd8799f001929b5ffff", "spend"},
			rows:         sqlmock.NewRows([]string{"data", "type"}),
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gw := &Gateway{}
			gw.DBService = dbService

			if len(tc.rowData) > 0 {
				encoded, err := hex.DecodeString(tc.rowData[0])
				require.Empty(t, err)
				tc.rows.AddRow(encoded, tc.rowData[1])

			}
			mockSql.ExpectQuery(`
SELECT distinct rd_data.bytes as data, rd.purpose as type
    FROM redeemer rd
    INNER JOIN redeemer_data as rd_data on rd.redeemer_data_id = rd_data.id
    LEFT JOIN tx_in generating_tx_in on generating_tx_in.redeemer_id = rd.id
    LEFT JOIN tx_out generating_tx_out on generating_tx_in.tx_out_id = generating_tx_out.tx_id and generating_tx_out."index" = generating_tx_in.tx_out_index
    WHERE rd.tx_id = \$1 AND \(rd.script_hash = \$2 OR generating_tx_out.address = \$3\)`).WillReturnRows(tc.rows).WillReturnError(tc.queryErr)

			response, err := gw.unmarshalConnectionEvent(dto.UtxoDto{
				Datum: &tc.requestDatum,
			})
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestUnmarshalChannelEvent(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	testCases := []struct {
		name         string
		requestDatum string
		rowData      []string
		rows         *sqlmock.Rows
		expectedErr  error
		queryErr     error
	}{
		{
			name:         "fail to DecodeConnectionDatumSchema",
			requestDatum: "",
			rows:         sqlmock.NewRows([]string{"data", "type"}).AddRow("d8799fd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff", "mint"),
			expectedErr:  fmt.Errorf("EOF"),
		},
		{
			name:         "fail to query redeemer connection",
			requestDatum: "d8799fd8799fd8799fd87a80d87a80d8799f487472616e7366657240ff9f4c636f6e6e656374696f6e2d30ff4769637332302d31ff010101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722030ffff",
			rows:         sqlmock.NewRows([]string{"data", "type"}).AddRow("d8799fd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff", "mint"),
			queryErr:     fmt.Errorf("not found"),
			expectedErr:  fmt.Errorf("not found"),
		},
		{
			name:         "success channel open init",
			requestDatum: "d8799fd8799fd8799fd87a80d87a80d8799f487472616e7366657240ff9f4c636f6e6e656374696f6e2d30ff4769637332302d31ff010101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722030ffff",
			rowData:      []string{"d8799fd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff", "mint"},
			rows:         sqlmock.NewRows([]string{"data", "type"}),
		},
		{
			name:         "success channel open ack",
			requestDatum: "d8799fd8799fd8799fd87a80d87a80d8799f487472616e7366657240ff9f4c636f6e6e656374696f6e2d30ff4769637332302d31ff010101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722030ffff",
			rowData:      []string{"d8799f4769637332302d31d8799f9fd8799fd8799fd8799f582d6368616e6e656c456e64732f706f7274732f7472616e736665722f6368616e6e656c732f6368616e6e656c2d305832080210011a150a08706f72742d31303012096368616e6e656c2d30220c636f6e6e656374696f6e2d302a0769637332302d31d8799f01000101450002b6ad01ff9fd8799f01460204b6ad0120582120473381815b9f17ff659accd588dc5ba21b016733cb7a16224354369a9c4d1ffdffd8799f01460406b6ad0120582120da15c2c1d5d4f27fb3f58379a1deb9815f68bc14fc0989f3837a66e8567eca06ffd8799f0146060ab6ad01205821207d67bc22d3e6f23f316b9bb4a0e639ae6dbf249f6d6a92d7561ed6d26c8d5867ffd8799f01460816b6ad012058212098846d4277c3ec61e2322398d76c30ffcc0c57961875679f5c91e112c142f65effd8799f01460a26b6ad0120582120e3375681bf463f39c7f5db5645a11afecb0b11cf9aec9a4929a3e069e1fe041affd8799f01460c46b6ad0120582120fb1aa23ae9edd014f7eb4a16a1348651b414c82d6f06ba9f5ed8eac599133fa2ffd8799f014710a001b6ad0120582120e78a3bbe46c1606841c93708d0a1a9fdf8ce4d17feca37022a22df09226d5184ffffffffffd8799fd8799fd8799f436962635820d1e4966b77a5846ee8fdff849a617585e2e7e88d4bb1fc3ec51bb8035cd7502cd8799f010001014100ff9fd8799f0158210106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f40ffd8799f0141015820f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc48ffd8799f0158210124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed40ffd8799f01582101766a75312b4e4a22df8efdb7266d137c63f961e9fb30be818b667045847bddc140ffd8799f01410158208f104d0c1d17dcaa82d6bfb8d063d204d221fdce0e192d131ba5144dd2216f65ffffffffffffffd8799f00192b5cffff", "spend"},
			rows:         sqlmock.NewRows([]string{"data", "type"}),
		},
	}
	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gw := &Gateway{}
			gw.DBService = dbService

			if len(tc.rowData) > 0 {
				encoded, err := hex.DecodeString(tc.rowData[0])
				require.Empty(t, err)
				tc.rows.AddRow(encoded, tc.rowData[1])

			}

			mockSql.ExpectQuery(`
SELECT distinct rd_data.bytes as data, rd.purpose as type
    FROM redeemer rd
    INNER JOIN redeemer_data as rd_data on rd.redeemer_data_id = rd_data.id
    LEFT JOIN tx_in generating_tx_in on generating_tx_in.redeemer_id = rd.id
    LEFT JOIN tx_out generating_tx_out on generating_tx_in.tx_out_id = generating_tx_out.tx_id and generating_tx_out."index" = generating_tx_in.tx_out_index
    WHERE rd.tx_id = \$1 AND \(rd.script_hash = \$2 OR generating_tx_out.address = \$3\)`).WillReturnRows(tc.rows).WillReturnError(tc.queryErr)

			response, err := gw.unmarshalChannelEvent(dto.UtxoDto{
				Datum: &tc.requestDatum,
			})
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestUnmarshalClientEvents(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	chainHandler, err := helpers.GetChainHandler()
	require.NoError(t, err)
	createHex, err := hex.DecodeString("d8799fd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff")
	require.NoError(t, err)

	updatehex, err := hex.DecodeString("d8799fd8799fd8799fd8799fd8799fd8799f0b00ff4973696465636861696e1928b91b17e4761c9f37a5d7d8799f58200c722301809037a4702b76f6fc21dcd4b0ea0d92a3f472cd743fbc82a8a3c9dfd8799f0158208a9b1f58c38eda0b48892359c5acb4338e9cedd4c652af945a4006f15f85fef4ffff5820e8d223bffe7f1e3b1b62bb0ee53f14001a5f6f5ac5342b14d14983614fc3f4515820e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85558201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b858201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b85820048091bc7ddc283f77bfbf91d73c44da58c3df8a9cbc867405d8b7f3daada22f58208ddd87d079d4ccc0137b9e96af97395611aa0a67944e17f427073ef7f80d0fd35820e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8555820e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85554945c9a156abbb88bcd4cc9fc90c497254bbadd03ffd8799f1928b900d8799f582082fff6f56cfc44da046fa2d6bcf963b64e215ac2be26fe73a00060e6af9a8215d8799f015820a92cb09b2b14903509c6b9b5592e9a07abaf58138bd08a254a3a65912ac6a4eaffff9fd8799f0254945c9a156abbb88bcd4cc9fc90c497254bbadd031b17e4761cdcd1ca16584054fbfcee6d5f7fbf4e046638f5f6ba68a8116a5a28b2883d5d6ac4f16eb7adb918d70ec17f1bab729ae617cf181d888db2791b10f59bff616bef4377a57adf08ffffffffd8799f9fd8799f54945c9a156abbb88bcd4cc9fc90c497254bbadd035820fc5548d5e90553af6be22cb776020a5d631c753b3b161bb7f8ac51548690bc520a00ffffd8799f54945c9a156abbb88bcd4cc9fc90c497254bbadd035820fc5548d5e90553af6be22cb776020a5d631c753b3b161bb7f8ac51548690bc520a00ff0affd8799f00192780ffd8799f9fd8799f54945c9a156abbb88bcd4cc9fc90c497254bbadd035820fc5548d5e90553af6be22cb776020a5d631c753b3b161bb7f8ac51548690bc520a00ffffd8799f54945c9a156abbb88bcd4cc9fc90c497254bbadd035820fc5548d5e90553af6be22cb776020a5d631c753b3b161bb7f8ac51548690bc520a00ff0affffffff")
	require.NoError(t, err)
	require.NoError(t, err)
	testCases := []struct {
		name                string
		requestAssetsPolicy string
		requestDatum        string
		returnData          *sqlmock.Rows
		queryErr            error
		expectedErr         error
	}{
		{
			name:                "fail to DecodeClientDatumSchema",
			requestAssetsPolicy: chainHandler.Validators.MintClient.ScriptHash,
			requestDatum:        "",
			expectedErr:         fmt.Errorf("EOF"),
			returnData:          sqlmock.NewRows([]string{"data", "type"}).AddRow(createHex, "mint"),
		},
		{
			name:                "fail to QueryRedeemersByTransactionId",
			requestAssetsPolicy: chainHandler.Validators.MintClient.ScriptHash,
			requestDatum:        "d8799fd8799fd8799f4973696465636861696ed8799f0103ff1b0005795974ab80001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f00192780ff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffa1d8799f00192780ffd8799f1b17e475d0f23a98ec58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c60c0a126cad2ccf5a5f0f3add2bcec75bac94399ca7b4d2873ac5984647eff4ffffffd8799f581c13cd4d50ea648ba4572068250c6fa9a24c7284dfdbef6fa066541c6a581914807575bdd0c3aa43547c44f70b3c0552b5cb66f2c9db6430ffff",
			queryErr:            fmt.Errorf("not found"),
			expectedErr:         fmt.Errorf("not found"),
			returnData:          sqlmock.NewRows([]string{"data", "type"}).AddRow(createHex, "mint"),
		},
		{
			name:                "success client create",
			requestAssetsPolicy: chainHandler.Validators.MintClient.ScriptHash,
			requestDatum:        "d8799fd8799fd8799f4973696465636861696ed8799f0103ff1b0005795974ab80001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f00192780ff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffa1d8799f00192780ffd8799f1b17e475d0f23a98ec58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c60c0a126cad2ccf5a5f0f3add2bcec75bac94399ca7b4d2873ac5984647eff4ffffffd8799f581c13cd4d50ea648ba4572068250c6fa9a24c7284dfdbef6fa066541c6a581914807575bdd0c3aa43547c44f70b3c0552b5cb66f2c9db6430ffff",
			returnData:          sqlmock.NewRows([]string{"data", "type"}).AddRow(createHex, "mint"),
		},
		{
			name:                "success client update",
			requestAssetsPolicy: chainHandler.Validators.MintClient.ScriptHash,
			requestDatum:        "d8799fd8799fd8799f4973696465636861696ed8799f0103ff1b0005795974ab80001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f00192780ff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffa1d8799f00192780ffd8799f1b17e475d0f23a98ec58201348fa29c20bc10dd1597b91337b65b75772abcdc5306d53e593ae10421fb4b8d8799f5820c60c0a126cad2ccf5a5f0f3add2bcec75bac94399ca7b4d2873ac5984647eff4ffffffd8799f581c13cd4d50ea648ba4572068250c6fa9a24c7284dfdbef6fa066541c6a581914807575bdd0c3aa43547c44f70b3c0552b5cb66f2c9db6430ffff",
			returnData:          sqlmock.NewRows([]string{"data", "type"}).AddRow(updatehex, "spend"),
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			dbService, mockDB, mockSql := dbservice.SetUpMockDb(t)
			defer mockDB.Close()
			gw := &Gateway{}
			gw.DBService = dbService
			hexAssetsPolicy, err := hex.DecodeString(tc.requestAssetsPolicy)
			require.NoError(t, err)

			hexDatum, err := hex.DecodeString(tc.requestDatum)
			require.NoError(t, err)

			mockSql.ExpectQuery(`
SELECT distinct rd_data.bytes as data, rd.purpose as type
    FROM redeemer rd
    INNER JOIN redeemer_data as rd_data on rd.redeemer_data_id = rd_data.id
    LEFT JOIN tx_in generating_tx_in on generating_tx_in.redeemer_id = rd.id
    LEFT JOIN tx_out generating_tx_out on generating_tx_in.tx_out_id = generating_tx_out.tx_id and generating_tx_out."index" = generating_tx_in.tx_out_index
    WHERE rd.tx_id = \$1 AND \(rd.script_hash = \$2 OR generating_tx_out.address = \$3\)`).
				WillReturnError(tc.queryErr).WillReturnRows(tc.returnData)

			response, err := gw.unmarshalClientEvents([]dto.UtxoRawDto{
				{
					AssetsPolicy: hexAssetsPolicy,
					AssetsName:   nil,
					DatumHash:    nil,
					Datum:        hexDatum,
					BlockNo:      0,
					BlockId:      0,
					Index:        0,
				},
			})
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}

func TestQueryBlockResults(t *testing.T) {
	err := os.Chdir("../../")
	require.Nil(t, err)
	defer os.Chdir("./package/services")
	chainHandler, err := helpers.GetChainHandler()
	require.NoError(t, err)
	deCodeConHash, err := hex.DecodeString(chainHandler.Validators.MintConnection.ScriptHash)
	require.NoError(t, err)
	deCodeChanHash, err := hex.DecodeString(chainHandler.Validators.MintChannel.ScriptHash)
	require.NoError(t, err)
	datumConHex, err := hex.DecodeString("d8799fd8799f4c6962635f636c69656e742d309fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f56323030302d63617264616e6f2d6d69746872696c2d3040d8799f43696263ffff00ffd8799f581cbdfb32518d476b159f489e0a5cddb863e590e692fa7c80505ade2add581914807575bdd0c3aa43547c44f70b3c0552b5cb6619dd9b3030ffff")
	require.NoError(t, err)
	testCases := []struct {
		name             string
		returnRow        *sqlmock.Rows
		queryDbErr       error
		queryDbUnmarshal error
		expectedErr      error
	}{
		{
			name:        "fail to QueryConnectionAndChannelUTxOs",
			returnRow:   sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name", "block_no", "block_id"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d32ff9f4c636f6e6e656374696f6e2d33ff4769637332302d31ff030101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722033ffff", "assets_policy", "assets_name", 1, 1),
			queryDbErr:  fmt.Errorf("not found"),
			expectedErr: fmt.Errorf("not found"),
		},
		{
			name:             "fail in case unmarshalConnectionEvent",
			returnRow:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d32ff9f4c636f6e6e656374696f6e2d33ff4769637332302d31ff030101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722033ffff", deCodeConHash, "assets_name"),
			queryDbUnmarshal: fmt.Errorf("invalid"),
			expectedErr:      fmt.Errorf("invalid"),
		},
		{
			name:             "fail in case unmarshalChannelEvent",
			returnRow:        sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", "\\xd8799fd8799fd8799fd87c80d87a80d8799f487472616e73666572496368616e6e656c2d32ff9f4c636f6e6e656374696f6e2d33ff4769637332302d31ff030101a0a0a0ff48706f72742d313030d8799f581c0282bc48b32d7cf199cacc7acbef3069e9a94067e620546e17962bec581914807575bdd0c3aa43547c44f70b3c0552b5cb66239b722033ffff", deCodeChanHash, "assets_name"),
			queryDbUnmarshal: fmt.Errorf("invalid"),
			expectedErr:      fmt.Errorf("invalid"),
		},
		{
			name:      "success unmarshalConnectionEvent",
			returnRow: sqlmock.NewRows([]string{"address", "tx_hash", "tx_id", "output_index", "datum_hash", "datum", "assets_policy", "assets_name"}).AddRow("address", "__hash_value", 1, 1, "datum_hash", datumConHex, deCodeConHash, "assets_name"),
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
				WillReturnRows(tc.returnRow).
				WillReturnError(tc.queryDbErr)

			if strings.Contains(tc.name, "unmarshalConnectionEvent") {
				dataHex, err := hex.DecodeString("d8799fd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff")
				require.NoError(t, err)
				mockSql.ExpectQuery(`
SELECT distinct rd_data.bytes as data, rd.purpose as type
    FROM redeemer rd
    INNER JOIN redeemer_data as rd_data on rd.redeemer_data_id = rd_data.id
    LEFT JOIN tx_in generating_tx_in on generating_tx_in.redeemer_id = rd.id
    LEFT JOIN tx_out generating_tx_out on generating_tx_in.tx_out_id = generating_tx_out.tx_id and generating_tx_out."index" = generating_tx_in.tx_out_index
    WHERE rd.tx_id = \$1 AND \(rd.script_hash = \$2 OR generating_tx_out.address = \$3\)`).
					WillReturnError(tc.queryDbUnmarshal).
					WillReturnRows(sqlmock.NewRows([]string{"data", "type"}).AddRow(dataHex, "mint"))
			}

			if strings.Contains(tc.name, "unmarshalChannelEvent") {
				dataHex, err := hex.DecodeString("d8799fd8799f581c8bc24e12ec136dbff5ccb05380fdaae66089182bde45bfd22be0a67b4768616e646c6572ffff")
				require.NoError(t, err)
				mockSql.ExpectQuery(`
SELECT distinct rd_data.bytes as data, rd.purpose as type
    FROM redeemer rd
    INNER JOIN redeemer_data as rd_data on rd.redeemer_data_id = rd_data.id
    LEFT JOIN tx_in generating_tx_in on generating_tx_in.redeemer_id = rd.id
    LEFT JOIN tx_out generating_tx_out on generating_tx_in.tx_out_id = generating_tx_out.tx_id and generating_tx_out."index" = generating_tx_in.tx_out_index
    WHERE rd.tx_id = \$1 AND \(rd.script_hash = \$2 OR generating_tx_out.address = \$3\)`).
					WillReturnError(tc.queryDbUnmarshal).
					WillReturnRows(sqlmock.NewRows([]string{"data", "type"}).AddRow(dataHex, "mint"))
			}

			response, err := gw.QueryBlockResults(1)
			if tc.expectedErr != nil {
				require.ErrorContains(t, err, tc.expectedErr.Error())
			} else {
				require.NotEmpty(t, response)
			}
		})
	}
}
