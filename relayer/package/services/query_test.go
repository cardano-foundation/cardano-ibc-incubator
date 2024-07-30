package services

import (
	"context"
	"encoding/hex"
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/cardano/relayer/v1/package/dbservice"
	mithrilpacket "github.com/cardano/relayer/v1/package/mithril"
	mithrilservice "github.com/cardano/relayer/v1/package/mithril"
	"github.com/cardano/relayer/v1/package/services/helpers"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos/mithril"
	"github.com/stretchr/testify/require"
	"net/http"
	"os"

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
