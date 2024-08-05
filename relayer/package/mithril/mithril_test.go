package mithril

import (
	http_client "github.com/cardano/relayer/v1/package/http-client"
	"github.com/h2non/gock"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
)

var mithril MithrilService

func TestGetListMithrilStakeDistributions(t *testing.T) {
	t.Run("GetListMithrilStakeDistributions Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		mithrilStakeDistributions, err := mithril.GetListMithrilStakeDistributions()
		if err != nil {
			t.Error(err.Error())
		} else {
			require.NotEmpty(t, mithrilStakeDistributions)
		}
		//fmt.Println(mithrilStakeDistributions)
	})
	t.Run("GetListMithrilStakeDistributions Fail", func(t *testing.T) {
		gock.New("https://aggregator.testing-preview.api.mithril.network").
			Get("/aggregator/artifact/mithril-stake-distributions").
			Reply(400).
			JSON(map[string]string{"message": "fail"})
		defer gock.Off()
		service := NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
		_, err := service.GetListMithrilStakeDistributions()
		require.Error(t, err)
	})
}

func TestGetEpochSetting(t *testing.T) {
	t.Run("GetEpochSetting Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		epochSetting, err := mithril.GetEpochSetting()
		if err != nil {
			t.Error(err.Error())
		} else {
			require.NotEmpty(t, epochSetting)
		}
		//fmt.Println(epochSetting)
	})
	t.Run("GetEpochSetting Fail", func(t *testing.T) {
		gock.New("https://aggregator.testing-preview.api.mithril.network").
			Get("/aggregator/epoch-settings").
			Reply(400).
			JSON(map[string]string{"message": "fail"})
		defer gock.Off()
		service := NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
		_, err := service.GetEpochSetting()
		require.Error(t, err)
	})
}

func TestGetListCertificates(t *testing.T) {
	t.Run("GetListCertificates Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		certificates, err := mithril.GetListCertificates()
		if err != nil {
			t.Error(err.Error())
		} else {
			require.NotEmpty(t, certificates)
		}
		//fmt.Println(certificates)
	})
	t.Run("GetListCertificates Fail", func(t *testing.T) {
		gock.New("https://aggregator.testing-preview.api.mithril.network").
			Get("/aggregator/certificates").
			Reply(400).
			JSON(map[string]string{"message": "fail"})
		defer gock.Off()
		service := NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
		_, err := service.GetListCertificates()
		require.Error(t, err)
	})
}

func TestGetCertificateByHash(t *testing.T) {
	t.Run("GetCertificateByHash Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		certificate, err := mithril.GetCertificateByHash("eb3f5452bfc2f27022c566dd26deaa57b0b626fd3ea96d637831a6509e592550")
		if err != nil {
			t.Error(err.Error())
		} else {
			require.NotEmpty(t, certificate)
		}
		//fmt.Println(certificate)
	})
	t.Run("GetCertificateByHash Fail", func(t *testing.T) {
		gock.New("https://aggregator.testing-preview.api.mithril.network").
			Get("/aggregator/certificate/eb3f5452bfc2f27022c566dd26deaa57b0b626fd3ea96d637831a6509e592550").
			Reply(400).
			JSON(map[string]string{"message": "fail"})
		defer gock.Off()
		service := NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
		_, err := service.GetCertificateByHash("eb3f5452bfc2f27022c566dd26deaa57b0b626fd3ea96d637831a6509e592550")
		require.Error(t, err)
	})
}

func TestGetListSnapshots(t *testing.T) {
	t.Run("GetListSnapshots Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		snapshots, err := mithril.GetListSnapshots()
		if err != nil {
			t.Error(err.Error())
		} else {
			require.NotEmpty(t, snapshots)
		}
		//fmt.Println(snapshots)
	})
	t.Run("GetListSnapshots Fail", func(t *testing.T) {
		gock.New("https://aggregator.testing-preview.api.mithril.network").
			Get("/aggregator/artifact/snapshots").
			Reply(400).
			JSON(map[string]string{"message": "fail"})
		defer gock.Off()
		service := NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
		_, err := service.GetListSnapshots()
		require.Error(t, err)
	})
}

func TestGetCardanoTransactionsSetSnapshot(t *testing.T) {
	t.Run("GetCardanoTransactionsSetSnapshot Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		cardanoTransactions, err := mithril.GetCardanoTransactionsSetSnapshot()
		if err != nil {
			t.Error(err.Error())
		} else {
			require.NotEmpty(t, cardanoTransactions)
		}
		//fmt.Println(cardanoTransactions)
	})
	t.Run("GetCardanoTransactionsSetSnapshot Fail", func(t *testing.T) {
		gock.New("https://aggregator.testing-preview.api.mithril.network").
			Get("/aggregator/artifact/cardano-transactions-set-snapshot").
			Reply(400).
			JSON(map[string]string{"message": "fail"})
		defer gock.Off()
		service := NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
		_, err := service.GetCardanoTransactionsSetSnapshot()
		require.Error(t, err)
	})
}

func TestGetCardanoTransactionSetSnapshotByHash(t *testing.T) {
	t.Run("GetCardanoTransactionSetSnapshotByHash Success", func(t *testing.T) {
		gock.New("https://aggregator.testing-preview.api.mithril.network").
			Get("/aggregator/artifact/cardano-transaction/hash_value").
			Reply(200).
			JSON(map[string]string{"message": "success"})
		defer gock.Off()
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		_, err := mithril.GetCardanoTransactionSetSnapshotByHash("hash_value")
		if err != nil {
			t.Error(err.Error())
		}
	})
	t.Run("GetCardanoTransactionSetSnapshotByHash Fail", func(t *testing.T) {
		gock.New("https://aggregator.testing-preview.api.mithril.network").
			Get("/aggregator/artifact/cardano-transaction/hash_value").
			Reply(400).
			JSON(map[string]string{"message": "fail"})
		defer gock.Off()
		service := NewMithrilService("https://aggregator.testing-preview.api.mithril.network/aggregator")
		_, err := service.GetCardanoTransactionSetSnapshotByHash("hash_value")
		require.Error(t, err)
	})
}

func TestGetProofOfACardanoTransactionList(t *testing.T) {
	testCases := []struct {
		name       string
		statusCode int
	}{
		{
			name:       "success",
			statusCode: http.StatusOK,
		},
		{
			name:       "fail",
			statusCode: http.StatusBadRequest,
		},
	}
	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			gock.New("https://aggregator.testing-preview.api.mithril.network").
				Get("/aggregator/proof/cardano-transaction").MatchParam("transaction_hashes", "hash_value").
				Reply(tc.statusCode).
				JSON(map[string]string{"message": "fail"})
			defer gock.Off()
			mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
			_, err := mithril.GetProofOfACardanoTransactionList("hash_value")
			if tc.statusCode == http.StatusOK {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
		})
	}

}
