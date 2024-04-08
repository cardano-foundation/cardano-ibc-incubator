package cardano_test

import (
	"sidechain/x/clients/cardano"

	sdk "github.com/cosmos/cosmos-sdk/types"
	clienttypes "github.com/cosmos/ibc-go/v8/modules/core/02-client/types"
)

// expected export ordering:
// processed height and processed time per height
// then all iteration keys
func (suite *CardanoTestSuite) TestExportMetadata() {
	suite.SetupTest()

	path := NewPath(suite.chainA, suite.chainB)
	SetupCardanoClientInCosmos(suite.coordinator, path)

	clientStore := suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID)
	clientState := path.EndpointA.GetClientState()
	height := clientState.GetLatestHeight()

	initIteration := cardano.GetIterationKey(clientStore, height)
	suite.Require().NotEqual(0, len(initIteration))
	initProcessedTime, found := cardano.GetProcessedTime(clientStore, height)
	suite.Require().True(found)
	initProcessedHeight, found := cardano.GetProcessedHeight(clientStore, height)
	suite.Require().True(found)

	gm := clientState.ExportMetadata(suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID))
	suite.Require().NotNil(gm, "client with metadata returned nil exported metadata")
	suite.Require().Len(gm, 3, "exported metadata has unexpected length")

	suite.Require().Equal(cardano.ProcessedHeightKey(height), gm[0].GetKey(), "metadata has unexpected key")
	actualProcessedHeight, err := clienttypes.ParseHeight(string(gm[0].GetValue()))
	suite.Require().NoError(err)
	suite.Require().Equal(initProcessedHeight, actualProcessedHeight, "metadata has unexpected value")

	suite.Require().Equal(cardano.ProcessedTimeKey(height), gm[1].GetKey(), "metadata has unexpected key")
	suite.Require().Equal(initProcessedTime, sdk.BigEndianToUint64(gm[1].GetValue()), "metadata has unexpected value")

	suite.Require().Equal(cardano.IterationKey(height), gm[2].GetKey(), "metadata has unexpected key")
	suite.Require().Equal(initIteration, gm[2].GetValue(), "metadata has unexpected value")

	// test updating client and exporting metadata
	// err = path.EndpointA.UpdateClient()
	clientMessage := &cardano.BlockData{
		Height: &cardano.Height{
			RevisionNumber: 0,
			RevisionHeight: 303388,
		},
		Slot:       1214030,
		Hash:       "17e149f64bcdb3c02cfaf474bda7b72c101c3d8f0ef63d98e8ab1bb1426fdef6",
		PrevHash:   "40b933e31ffbb08a719d6166bb076cdf1558f3ff6130c02acd6fa15f359a7bd5",
		EpochNo:    3,
		HeaderCbor: headerCbor,
		BodyCbor:   bodyCbor,
		EpochNonce: "05B05B22EDD9CE5A1868BF7BAF80934AB56E3D9305F385A5F68CB41848A721B1",
		Timestamp:  1707122694,
		ChainId:    chainID,
	}
	clientState.UpdateState(suite.chainA.GetContext(), suite.chainA.App.AppCodec(), clientStore, clientMessage)

	suite.Require().NoError(err)

	clientState = path.EndpointA.GetClientState()
	updateHeight := clientState.GetLatestHeight()

	iteration := cardano.GetIterationKey(clientStore, updateHeight)
	suite.Require().NotEqual(0, len(initIteration))
	processedTime, found := cardano.GetProcessedTime(clientStore, updateHeight)
	suite.Require().True(found)
	processedHeight, found := cardano.GetProcessedHeight(clientStore, updateHeight)
	suite.Require().True(found)

	gm = clientState.ExportMetadata(suite.chainA.App.GetIBCKeeper().ClientKeeper.ClientStore(suite.chainA.GetContext(), path.EndpointA.ClientID))
	suite.Require().NotNil(gm, "client with metadata returned nil exported metadata")
	suite.Require().Len(gm, 6, "exported metadata has unexpected length")

	// expected ordering:
	// initProcessedHeight, initProcessedTime, processedHeight, processedTime, initIteration, iteration

	// check init processed height and time
	suite.Require().Equal(cardano.ProcessedHeightKey(height), gm[0].GetKey(), "metadata has unexpected key")
	actualProcessedHeight, err = clienttypes.ParseHeight(string(gm[0].GetValue()))
	suite.Require().NoError(err)
	suite.Require().Equal(initProcessedHeight, actualProcessedHeight, "metadata has unexpected value")

	suite.Require().Equal(cardano.ProcessedTimeKey(height), gm[1].GetKey(), "metadata has unexpected key")
	suite.Require().Equal(initProcessedTime, sdk.BigEndianToUint64(gm[1].GetValue()), "metadata has unexpected value")

	// check processed height and time after update
	suite.Require().Equal(cardano.ProcessedHeightKey(updateHeight), gm[2].GetKey(), "metadata has unexpected key")
	actualProcessedHeight, err = clienttypes.ParseHeight(string(gm[2].GetValue()))
	suite.Require().NoError(err)
	suite.Require().Equal(processedHeight, actualProcessedHeight, "metadata has unexpected value")

	suite.Require().Equal(cardano.ProcessedTimeKey(updateHeight), gm[3].GetKey(), "metadata has unexpected key")
	suite.Require().Equal(processedTime, sdk.BigEndianToUint64(gm[3].GetValue()), "metadata has unexpected value")

	// check iteration keys
	suite.Require().Equal(cardano.IterationKey(height), gm[4].GetKey(), "metadata has unexpected key")
	suite.Require().Equal(initIteration, gm[4].GetValue(), "metadata has unexpected value")

	suite.Require().Equal(cardano.IterationKey(updateHeight), gm[5].GetKey(), "metadata has unexpected key")
	suite.Require().Equal(iteration, gm[5].GetValue(), "metadata has unexpected value")
}
