package mithril

import (
	"fmt"
	http_client "github.com/cardano/relayer/v1/package/http-client"
	"github.com/cardano/relayer/v1/package/mithril/dtos"
)

type MithrilService struct {
	client http_client.Request
}

func NewMithrilService(baseUrl string) *MithrilService {
	return &MithrilService{
		client: http_client.InitClient(baseUrl, nil),
	}
}

func (mithril *MithrilService) GetListMithrilStakeDistributions() ([]dtos.MithrilStakeDistribution, error) {
	var result []dtos.MithrilStakeDistribution
	err := mithril.client.Get(&result, "/artifact/mithril-stake-distributions", nil)
	if err != nil {
		return []dtos.MithrilStakeDistribution{}, err
	}

	return result, err
}

func (mithril *MithrilService) GetEpochSetting() (dtos.EpochSetting, error) {
	var result dtos.EpochSetting
	err := mithril.client.Get(&result, "/epoch-settings", nil)
	if err != nil {
		return dtos.EpochSetting{}, err
	}

	return result, err
}

func (mithril *MithrilService) GetListCertificates() ([]dtos.CertificateOverall, error) {
	var result []dtos.CertificateOverall
	err := mithril.client.Get(&result, "/certificates", nil)
	if err != nil {
		return []dtos.CertificateOverall{}, err
	}

	return result, err
}

func (mithril *MithrilService) GetCertificateByHash(hash string) (*dtos.CertificateDetail, error) {
	var result *dtos.CertificateDetail
	err := mithril.client.Get(&result, fmt.Sprintf("/certificate/%s", hash), nil)
	if err != nil {
		return nil, err
	}

	return result, err
}

func (mithril *MithrilService) GetListSnapshots() ([]dtos.Snapshot, error) {
	var result []dtos.Snapshot
	err := mithril.client.Get(&result, "/artifact/snapshots", nil)
	if err != nil {
		return []dtos.Snapshot{}, err
	}

	return result, err
}

func (mithril *MithrilService) GetCardanoTransactionsSetSnapshot() ([]dtos.CardanoTransactionSetSnapshot, error) {
	var result []dtos.CardanoTransactionSetSnapshot
	err := mithril.client.Get(&result, "/artifact/cardano-transactions", nil)
	if err != nil {
		return []dtos.CardanoTransactionSetSnapshot{}, err
	}

	return result, err
}
func (mithril *MithrilService) GetCardanoTransactionSetSnapshotByHash(hash string) (*dtos.CardanoTransactionSetSnapshot, error) {
	var result *dtos.CardanoTransactionSetSnapshot
	err := mithril.client.Get(&result, fmt.Sprintf("/artifact/cardano-transaction/%s", hash), nil)
	if err != nil {
		return nil, err
	}

	return result, err
}

func (mithril MithrilService) GetProofOfACardanoTransactionList(hashes string) (*dtos.ProofTransaction, error) {
	var result *dtos.ProofTransaction
	err := mithril.client.Get(&result, fmt.Sprintf("/proof/cardano-transaction?transaction_hashes=%s", hashes), nil)
	if err != nil {
		return nil, err
	}

	return result, err

}
