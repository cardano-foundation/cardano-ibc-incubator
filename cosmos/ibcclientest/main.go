package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"strconv"

	client2 "github.com/cometbft/cometbft/rpc/client"

	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/ignite/cli/v28/ignite/pkg/cosmosclient"
)

const (
	KeyClientSPOsPrefix = "clientSPOs"
	KeySPOStatePrefix   = "SPOState"

	AddressPrefix = "cosmos"
	Url           = "http://localhost"
	PortGRPC      = 26657
	PortHTTP      = 1317
)

func main() {
	ctx := context.Background()

	pathStore := fmt.Sprintf("/store/%s/%s", "ibc", "key")
	defaultOpts := client2.ABCIQueryOptions{
		Height: 0, // at last height with value = 0
		Prove:  false,
	}

	nextClientSequenceBytes := queryABCI(ctx, pathStore, []byte("nextClientSequence"), defaultOpts)
	clientSeq := sdk.BigEndianToUint64(nextClientSequenceBytes)
	clientId := "099-cardano-" + strconv.Itoa(int(clientSeq-1))
	fmt.Printf("ClientSeq: %v\n", clientSeq)

	epochNumber := GetLatestEpochNo(clientId)
	fmt.Println("Current Epoch: ", epochNumber)
	currentSPOs := queryABCI(ctx, pathStore, []byte(fmt.Sprintf("clients/%s/%s/%v", clientId, KeyClientSPOsPrefix, epochNumber)), defaultOpts)
	fmt.Println("Current SPOs: ", string(currentSPOs))

	stateChangeAtEpochPlus2 := queryABCI(ctx, pathStore, []byte(fmt.Sprintf("clients/%s/%s/%v", clientId, KeySPOStatePrefix, epochNumber+2)), defaultOpts)
	fmt.Printf("Epoch %v SPOs State: %v\n", epochNumber+2, string(stateChangeAtEpochPlus2))

	stateChangeAtEpochPlus3 := queryABCI(ctx, pathStore, []byte(fmt.Sprintf("clients/%s/%s/%v", clientId, KeySPOStatePrefix, epochNumber+3)), defaultOpts)
	fmt.Printf("Epoch %v SPOs State: %v\n", epochNumber+3, string(stateChangeAtEpochPlus3))
}

func queryABCI(ctx context.Context, pathStore string, key []byte, opts client2.ABCIQueryOptions) []byte {
	nodeAddress := fmt.Sprintf("%s:%v", Url, PortGRPC)

	// Create a Cosmos client instance
	client, err := cosmosclient.New(
		ctx,
		cosmosclient.WithAddressPrefix(AddressPrefix),
		cosmosclient.WithNodeAddress(nodeAddress),
	)
	if err != nil {
		log.Fatal(err)
	}
	res, _ := client.RPC.ABCIQueryWithOptions(ctx, pathStore, key, opts)
	return res.Response.GetValue()
}

func GetLatestEpochNo(clientId string) uint64 {
	client := &http.Client{}
	path := fmt.Sprintf("%s:%v/%s/%s", Url, PortHTTP, "ibc/core/client/v1/client_states/", clientId)
	req, _ := http.NewRequest("GET", path, nil)
	resp, err := client.Do(req)
	if err != nil {
		return 0
	}

	body, err := ioutil.ReadAll(resp.Body)

	var resClients ResponseGetClient
	err = json.Unmarshal(body, &resClients)
	if err != nil {
		log.Panicf("Error occur when pase response with detail: %s", err.Error())
	}
	epochNumber, _ := strconv.ParseUint(resClients.ClientState.CurrentEpoch, 10, 64)
	return epochNumber
}

type ResponseGetClient struct {
	ClientState ClientState `json:"client_state"`
}
type ClientState struct {
	CurrentEpoch string `json:"current_epoch"`
}
