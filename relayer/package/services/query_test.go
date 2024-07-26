package services

import (
	"context"
	"fmt"
	mithrilservice "github.com/cardano/relayer/v1/package/mithril"
	"github.com/cardano/relayer/v1/relayer/chains/cosmos/mithril"
	"github.com/stretchr/testify/require"
	"net/http"

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
