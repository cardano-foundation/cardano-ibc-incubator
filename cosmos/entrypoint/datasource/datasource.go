package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"time"

	"github.com/ignite/cli/v28/ignite/pkg/cosmosclient"

	"entrypoint/x/vesseloracle/types"
)

const AddressPrefix = "cosmos"                                 // the address prefix of the entrypoint chain
const DataSourceCount = 8                                      // number of emulated data sources
const DefaultVesselIMO = "9525338"                             // the default IMO of the vessel to fetch data for
const DefaultChannelId = "channel-0"                           // the default value for the channel id of the transmit command
const OutlierDeparturePortUnLoCode = "DEBWE"                   // outlier departure port UNLOCODE identifier
const OutlierDeparturePortName = "BRAUNSCHWEIG"                // outlier departure port name
const EtaJitterOffsetSeconds int64 = 2 * 60                    // eta jitter offset (2 minutes)
const EtaJitterIntervalWidthSeconds int64 = 4 * 60             // eta jitter interval (4 minutes)
const EtaOutlierOffsetSeconds int64 = 6 * 60 * 60              // minimum outlier difference for eta is 6 hours
const EtaOutlierIntervalWidthSeconds int64 = 4 * 60 * 60       // the outlier eta is in the interval of -[OutlierOffset, OutlierOffset+OutlierInterval)
const LastDataReportJitterOffsetSeconds int64 = 30 * 60        // data report timestamp jitter offset (2 minutes)
const LastDataReportJitterIntervalWidthSeconds int64 = 60 * 60 // data report timestamp interval (4 minutes)
const DatalasticSimulationData = `{
  "data": {
    "uuid": "b8625b67-7142-cfd1-7b85-595cebfe4191",
    "name": "MAERSK CHENNAI",
    "mmsi": "566093000",
    "imo": "9525338",
    "eni": null,
    "country_iso": "SG",
    "type": "Cargo - Hazard A (Major)",
    "type_specific": "Container Ship",
    "lat": 0.60566,
    "lon": 55.61919,
    "speed": 15.8,
    "course": 219,
    "heading": 208,
    "current_draught": 14,
    "navigation_status": null,
    "destination": "INNSA\u003E\u003ECGPNR",
    "dest_port_uuid": "11ccc7a1-cb91-bfd8-fefd-520b892be1da",
    "dest_port": "POINTE NOIRE",
    "dest_port_unlocode": "CGPNR",
    "dep_port_uuid": "54a743e6-9bde-8200-f2e7-ac733637dbd4",
    "dep_port": "NHAVA SHEVA",
    "dep_port_unlocode": "INNSA",
    "last_position_epoch": 1726625760,
    "last_position_UTC": "2024-09-18T02:16:00Z",
    "atd_epoch": 1726280520,
    "atd_UTC": "2024-09-14T02:22:00Z",
    "eta_epoch": 1727690400,
    "eta_UTC": "2024-09-30T10:00:00Z",
    "timezone_offset_sec": 14400,
    "timezone": "+04"
  },
  "meta": {
    "duration": 0.004499582,
    "endpoint": "/api/v0/vessel_pro",
    "success": true
  }
}`

// data type returned by datalastic vessel_pro endpoint
type DatalasticVesselPro struct {
	Data struct {
		UUID              string    `json:"uuid"`
		Name              string    `json:"name"`
		Mmsi              string    `json:"mmsi"`
		Imo               string    `json:"imo"`
		Eni               string    `json:"eni"`
		CountryIso        string    `json:"country_iso"`
		Type              string    `json:"type"`
		TypeSpecific      string    `json:"type_specific"`
		Lat               float64   `json:"lat"`
		Lon               float64   `json:"lon"`
		Speed             float64   `json:"speed"`
		Course            int32     `json:"course"`
		Heading           int32     `json:"heading"`
		CurrentDraught    int       `json:"current_draught"`
		NavigationStatus  string    `json:"navigation_status"`
		Destination       string    `json:"destination"`
		DestPortUUID      string    `json:"dest_port_uuid"`
		DestPort          string    `json:"dest_port"`
		DestPortUnlocode  string    `json:"dest_port_unlocode"`
		DepPortUUID       string    `json:"dep_port_uuid"`
		DepPort           string    `json:"dep_port"`
		DepPortUnlocode   string    `json:"dep_port_unlocode"`
		LastPositionEpoch int64     `json:"last_position_epoch"`
		LastPositionUTC   time.Time `json:"last_position_UTC"`
		AtdEpoch          int64     `json:"atd_epoch"`
		AtdUTC            time.Time `json:"atd_UTC"`
		EtaEpoch          int64     `json:"eta_epoch"`
		EtaUTC            time.Time `json:"eta_UTC"`
		TimezoneOffsetSec int       `json:"timezone_offset_sec"`
		Timezone          string    `json:"timezone"`
	} `json:"data"`
	Meta struct {
		Duration float64 `json:"duration"`
		Endpoint string  `json:"endpoint"`
		Success  bool    `json:"success"`
	} `json:"meta"`
}

// fetch data from Datalastic API
func fetchVesselDataFromDatalastic(apiURL string, vesselImo string) (*DatalasticVesselPro, error) {
	resp, err := http.Get(apiURL) // Making an API call
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusForbidden {
			return nil, fmt.Errorf("No access to requested resource. Check the API keys. (%d)", resp.StatusCode)
		} else if resp.StatusCode == http.StatusNotFound {
			return nil, fmt.Errorf("Vessel with given IMO not found. (%s)", vesselImo)
		} else {
			return nil, fmt.Errorf("Unexpected status code: %d", resp.StatusCode)
		}
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var vesselData DatalasticVesselPro
	json.Unmarshal(body, &vesselData)

	return &vesselData, nil
}

// create data sets for vessels including outliers for ETA and departure port
func generateVesselData(apiData *DatalasticVesselPro) ([]DatalasticVesselPro, error) {
	var vesselDataSources [DataSourceCount]DatalasticVesselPro
	for vesselDataSourceIndex := 0; vesselDataSourceIndex < DataSourceCount; vesselDataSourceIndex++ {
		vesselDataSources[vesselDataSourceIndex] = *apiData

		// only leave the first data source unchanged compared to the reference and introduce slight eta jitter for every other data source, except the outlier
		if vesselDataSourceIndex > 1 {
			vesselDataSources[vesselDataSourceIndex].Data.EtaEpoch = vesselDataSources[vesselDataSourceIndex].Data.EtaEpoch - EtaJitterOffsetSeconds + rand.Int63n(EtaJitterIntervalWidthSeconds)
			vesselDataSources[vesselDataSourceIndex].Data.EtaUTC = time.Unix(int64(vesselDataSources[vesselDataSourceIndex].Data.EtaEpoch), 0).UTC()
			vesselDataSources[vesselDataSourceIndex].Data.LastPositionEpoch = vesselDataSources[vesselDataSourceIndex].Data.LastPositionEpoch - LastDataReportJitterOffsetSeconds + rand.Int63n(LastDataReportJitterIntervalWidthSeconds)
			vesselDataSources[vesselDataSourceIndex].Data.LastPositionUTC = time.Unix(int64(vesselDataSources[vesselDataSourceIndex].Data.LastPositionEpoch), 0).UTC()
		}

		// create outliers: for index == 1 create the eta outlier, for index == 2 create the departure port outlier
		if vesselDataSourceIndex == 1 {
			vesselDataSources[vesselDataSourceIndex].Data.EtaEpoch = vesselDataSources[vesselDataSourceIndex].Data.EtaEpoch - EtaOutlierOffsetSeconds - rand.Int63n(EtaOutlierIntervalWidthSeconds)
			vesselDataSources[vesselDataSourceIndex].Data.EtaUTC = time.Unix(int64(vesselDataSources[vesselDataSourceIndex].Data.EtaEpoch), 0).UTC()
		} else if vesselDataSourceIndex == 2 {
			vesselDataSources[vesselDataSourceIndex].Data.DepPortUnlocode = OutlierDeparturePortUnLoCode
			vesselDataSources[vesselDataSourceIndex].Data.DepPort = OutlierDeparturePortName
		}
	}
	return vesselDataSources[:], nil
}

// create transactions based on vessel data and submit them, returning the list of tx identifiers for further processing
func createAndSubmitDataReports(vesselDataSources []DatalasticVesselPro) ([]string, error) {
	var transactions []string = make([]string, len(vesselDataSources))

	ctx := context.Background()

	client, err := cosmosclient.New(ctx, cosmosclient.WithAddressPrefix(AddressPrefix))
	if err != nil {
		return transactions, fmt.Errorf("Could not create cosmos client: %v", err)
	}

	for index, vesselData := range vesselDataSources {
		dataSourceAccountName := fmt.Sprintf("ds%d", index)
		dataSourceAccount, err := client.Account(dataSourceAccountName)
		if err != nil {
			return transactions, fmt.Errorf("Could not determine account for data source: %v %v", dataSourceAccountName, err)
		}

		dataSourceAddress, err := dataSourceAccount.Address(AddressPrefix)
		if err != nil {
			return transactions, fmt.Errorf("Could not determine address for account: %v %v", dataSourceAccountName, err)
		}

		// Define a message to create a post
		msg := &types.MsgCreateVessel{
			Creator:  dataSourceAddress,
			Imo:      vesselData.Data.Imo,
			Ts:       uint64(vesselData.Data.LastPositionEpoch),
			Source:   dataSourceAddress,
			Lat:      int32(vesselData.Data.Lat * 100000), // convert to fixed point representation, multiply by 100000
			Lon:      int32(vesselData.Data.Lon * 100000), // convert to fixed point representation, multiply by 100000
			Speed:    int32(vesselData.Data.Speed * 10),   // convert to fixed point representation, multiply by 10
			Course:   vesselData.Data.Course,
			Heading:  vesselData.Data.Heading,
			Adt:      uint64(vesselData.Data.AtdEpoch),
			Eta:      uint64(vesselData.Data.EtaEpoch),
			Name:     vesselData.Data.Name,
			Destport: vesselData.Data.DestPortUnlocode,
			Depport:  vesselData.Data.DepPortUnlocode,
			Mmsi:     vesselData.Data.Mmsi,
		}

		fmt.Println("Submitting data report for", dataSourceAccountName, "with address", dataSourceAddress, "...")
		txResp, err := client.BroadcastTx(ctx, dataSourceAccount, msg)
		if err != nil {
			return transactions, fmt.Errorf("Could not broadcast transaction for data source %v: %v", dataSourceAccountName, err)
		}
		transactions[index] = txResp.TxHash
		fmt.Println(txResp)
	}

	return transactions, nil
}

// submit a data consolidation request message
func submitDataConsolidationRequest(imo string) (*string, error) {
	ctx := context.Background()

	client, err := cosmosclient.New(ctx, cosmosclient.WithAddressPrefix(AddressPrefix))
	if err != nil {
		return nil, fmt.Errorf("Could not create cosmos client: %v", err)
	}

	account, err := client.Account("bob")
	if err != nil {
		return nil, fmt.Errorf("Could not determine account bob: %v", err)
	}

	address, err := account.Address(AddressPrefix)
	if err != nil {
		return nil, fmt.Errorf("Could not determine address for account bob: %v", err)
	}

	msg := &types.MsgConsolidateReports{
		Creator: address,
		Imo:     imo,
	}

	fmt.Println("Submitting request for data consolidation from account bob, with address", address, "...")
	txResp, err := client.BroadcastTx(ctx, account, msg)
	if err != nil {
		return nil, fmt.Errorf("Could not broadcast transaction for data consolidation request: %v", err)
	}
	fmt.Println(txResp)

	return &txResp.TxHash, nil
}

// submit a transmit data report request message
func transmitConsolidatedDataReport(imo string, ts int64, channelId string) (*string, error) {
	ctx := context.Background()

	client, err := cosmosclient.New(ctx, cosmosclient.WithAddressPrefix(AddressPrefix))
	if err != nil {
		return nil, fmt.Errorf("Could not create cosmos client: %v", err)
	}

	account, err := client.Account("bob")
	if err != nil {
		return nil, fmt.Errorf("Could not determine account bob: %v", err)
	}

	address, err := account.Address(AddressPrefix)
	if err != nil {
		return nil, fmt.Errorf("Could not determine address for account bob: %v", err)
	}

	msg := &types.MsgTransmitReport{
		Creator: address,
		Imo:     imo,
		Ts:      uint64(ts),
		Channel: channelId,
	}

	fmt.Println("Submitting request for transmitting a consolidated data report from account bob, with address", address, "...")
	fmt.Println(channelId, imo, ts)
	txResp, err := client.BroadcastTx(ctx, account, msg)
	if err != nil {
		return nil, fmt.Errorf("Could not broadcast transaction for transmit data report request: %v", err)
	}
	fmt.Println(txResp)

	return &txResp.TxHash, nil
}

func main() {
	dataSourceCmd := flag.NewFlagSet("report", flag.ExitOnError)
	vesselImo := dataSourceCmd.String("imo", DefaultVesselIMO, "The IMO identifier of the ship you want to fetch data for.")
	simulate := dataSourceCmd.Bool("simulate", false, "Specify if the input shall be simulated (e.g. in case of bad connectivity or lack of API key.)")
	consolidateCmd := flag.NewFlagSet("consolidate", flag.ExitOnError)
	transmitCmd := flag.NewFlagSet("transmit", flag.ExitOnError)
	channelId := transmitCmd.String("channelid", DefaultChannelId, "Specify the channel id via which to transmit the data report.")
	transmitImo := transmitCmd.String("imo", DefaultVesselIMO, "The IMO identifier of the ship for which you want to transmit a data report.")
	transmitTs := transmitCmd.Int64("ts", 0, "The timestamp of the consolidated data report that shall be transmitted.")

	if len(os.Args) < 2 {
		fmt.Println("expected 'report' or 'consolidate' or 'transmit' subcommands")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "report", "r":
		dataSourceCmd.Parse(os.Args[2:])

		var vesselApiData DatalasticVesselPro
		if *simulate == false {
			apiKey := os.Getenv("VESSEL_DATALASTIC_API_KEY")
			if apiKey == "" {
				fmt.Println("You need to specify the VESSEL_DATALASTIC_API_KEY environment variable to run this application.")
				os.Exit(1)
			}

			fmt.Println("Fetching data for vessel with IMO " + *vesselImo)

			apiURL := "https://api.datalastic.com/api/v0/vessel_pro?api-key=" + apiKey + "&imo=" + *vesselImo // Replace with the actual API URL
			apiData, err := fetchVesselDataFromDatalastic(apiURL, *vesselImo)
			if err != nil {
				fmt.Println("Error fetching data: ", err)
				os.Exit(1)
			}
			vesselApiData = *apiData
		} else {
			json.Unmarshal([]byte(DatalasticSimulationData), &vesselApiData)
			fmt.Println("SIMULATED DATA", vesselApiData)
		}

		// 1. create data sets for vessels including outliers for ETA and departure port
		vesselDataSources, err := generateVesselData(&vesselApiData)
		for index, vesselData := range vesselDataSources {
			str, err := json.MarshalIndent(vesselData, "", "  ")
			if err != nil {
				fmt.Println("Error while marshalling: ", err)
				os.Exit(1)
			}
			fmt.Printf("vessel data [%d]: %v\n", index, string(str))
		}

		// 2. create and submit transactions/data reports to the blockchain and wait for acceptance
		transactions, err := createAndSubmitDataReports(vesselDataSources)
		if err != nil {
			fmt.Println("Error while creating and submitting transactions: ", err)
			os.Exit(1)
		}
		fmt.Println("Transactions: ", transactions)
	case "consolidate", "c":
		consolidateCmd.Parse(os.Args[2:])
		transaction, err := submitDataConsolidationRequest(*vesselImo)
		if err != nil {
			fmt.Println("Error while requesting data consolidation: ", err)
			os.Exit(1)
		}
		fmt.Println("Transaction: ", transaction)
	case "transmit", "t":
		transmitCmd.Parse(os.Args[2:])
		transaction, err := transmitConsolidatedDataReport(*transmitImo, *transmitTs, *channelId)
		if err != nil {
			fmt.Println("Error while requesting to transmit a data report: ", err)
			os.Exit(1)
		}
		fmt.Println("Transaction: ", transaction)
	default:
		fmt.Errorf("Invalid subcommand. Only supported subcommands are 'consolidate' and 'report' or 'c' and 'r'.")
		os.Exit(1)
	}
}
