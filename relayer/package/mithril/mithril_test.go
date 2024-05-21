package mithril

import (
	"fmt"
	http_client "github.com/cardano/relayer/v1/package/http-client"
	"testing"
)

var mithril MithrilService

func TestGetListMithrilStakeDistributions(t *testing.T) {
	t.Run("GetListMithrilStakeDistributions Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		mithrilStakeDistributions, err := mithril.GetListMithrilStakeDistributions()
		if err != nil {
			t.Error(err.Error())
		}
		fmt.Println(mithrilStakeDistributions)
	})
}

func TestGetEpochSetting(t *testing.T) {
	t.Run("GetEpochSetting Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		epochSetting, err := mithril.GetEpochSetting()
		if err != nil {
			t.Error(err.Error())
		}
		fmt.Println(epochSetting)
	})
}

func TestGetListCertificates(t *testing.T) {
	t.Run("GetListCertificates Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		certificates, err := mithril.GetListCertificates()
		if err != nil {
			t.Error(err.Error())
		}
		fmt.Println(certificates)
	})
}

func TestGetCertificateByHash(t *testing.T) {
	t.Run("GetCertificateByHash Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		certificate, err := mithril.GetCertificateByHash("eb3f5452bfc2f27022c566dd26deaa57b0b626fd3ea96d637831a6509e592550")
		if err != nil {
			t.Error(err.Error())
		}
		fmt.Println(certificate)
	})
}

func TestGetListSnapshots(t *testing.T) {
	t.Run("GetListSnapshots Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		snapshots, err := mithril.GetListSnapshots()
		if err != nil {
			t.Error(err.Error())
		}
		fmt.Println(snapshots)
	})
}

func TestGetCardanoTransactionsSetSnapshot(t *testing.T) {
	t.Run("GetCardanoTransactionsSetSnapshot Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		cardanoTransactions, err := mithril.GetCardanoTransactionsSetSnapshot()
		if err != nil {
			t.Error(err.Error())
		}
		fmt.Println(cardanoTransactions)
	})
}

func TestGetCardanoTransactionSetSnapshotByHash(t *testing.T) {
	t.Run("GetCardanoTransactionSetSnapshotByHash Success", func(t *testing.T) {
		mithril.client = http_client.InitClient("https://aggregator.testing-preview.api.mithril.network/aggregator", nil)
		cardanoTransactionSet, err := mithril.GetCardanoTransactionSetSnapshotByHash("b9a060bdfe0c3a712681f813bc096de46333945b44a406b987acdb23250189d6")
		if err != nil {
			t.Error(err.Error())
		}
		fmt.Println(cardanoTransactionSet)
	})
}
