package cardano

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"time"

	"github.com/blinklabs-io/gouroboros/cbor"
	"github.com/blinklabs-io/gouroboros/ledger"
	"github.com/gorilla/websocket"
)

type BabbageTransaction struct {
	cbor.StructAsArray
	cbor.DecodeStoreCbor
	Body       BabbageTransactionBody
	WitnessSet ledger.BabbageTransactionWitnessSet
	IsTxValid  bool
	TxMetadata *cbor.Value
}

type BabbageTransactionBody struct {
	ledger.BabbageTransactionBody
	TxOutputs []BabbageTransactionOutput `cbor:"1,keyasint,omitempty"`
	Update    *struct {
		cbor.StructAsArray
		ProtocolParamUpdates map[ledger.Blake2b224]ledger.BabbageProtocolParameterUpdate
		Epoch                uint64
	} `cbor:"6,keyasint,omitempty"`
	MetadataHash     []byte                                        `cbor:"7,keyasint,omitempty"`
	Mint             *ledger.MultiAsset[ledger.MultiAssetTypeMint] `cbor:"9,keyasint,omitempty"`
	CollateralReturn BabbageTransactionOutput                      `cbor:"16,keyasint,omitempty"`
}

type BabbageTransactionOutput struct {
	ledger.BabbageTransactionOutput
	legacyOutput bool
}

func (b *BabbageTransactionBody) UnmarshalCBOR(cborData []byte) error {
	return b.UnmarshalCbor(cborData, b)
}

func (o *BabbageTransactionOutput) UnmarshalCBOR(cborData []byte) error {
	// Save original CBOR
	o.SetCbor(cborData)
	// Try to parse as legacy output first
	var tmpOutput ledger.AlonzoTransactionOutput
	if _, err := cbor.Decode(cborData, &tmpOutput); err == nil {
		// Copy from temp legacy object to Babbage format
		o.OutputAddress = tmpOutput.OutputAddress
		o.OutputAmount = tmpOutput.OutputAmount
		o.legacyOutput = true
	} else {
		return cbor.DecodeGeneric(cborData, o)
	}
	return nil
}

func (o *BabbageTransactionOutput) MarshalCBOR() ([]byte, error) {
	if o.legacyOutput {
		var tmpOutput AlonzoTransactionOutputTmp
		tmpOutput.OutputAddress = o.OutputAddress
		tmpOutput.OutputAmount = o.OutputAmount
		return cbor.Encode(&tmpOutput)
	}
	var tmpOutput BabbageTransactionOutputTmp
	tmpOutput.OutputAddress = o.OutputAddress
	tmpOutput.OutputAmount = o.OutputAmount
	tmpOutput.DatumOption = o.DatumOption
	tmpOutput.ScriptRef = o.ScriptRef
	tmpOutput.legacyOutput = o.legacyOutput
	return cbor.Encode(&tmpOutput)
}

type AlonzoTransactionOutputTmp struct {
	cbor.StructAsArray
	cbor.DecodeStoreCbor
	OutputAddress ledger.Address
	OutputAmount  ledger.MaryTransactionOutputValue
}

type BabbageTransactionOutputTmp struct {
	cbor.DecodeStoreCbor
	OutputAddress ledger.Address                              `cbor:"0,keyasint,omitempty"`
	OutputAmount  ledger.MaryTransactionOutputValue           `cbor:"1,keyasint,omitempty"`
	DatumOption   *ledger.BabbageTransactionOutputDatumOption `cbor:"2,keyasint,omitempty"`
	ScriptRef     *cbor.Tag                                   `cbor:"3,keyasint,omitempty"`
	legacyOutput  bool
}

type Map map[string]interface{}

var fault = []byte(`error`)

func query(ctx context.Context, payload interface{}, v interface{}, endpoint string) (err error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var (
		ch     = make(chan error, 1)
		conn   *websocket.Conn
		closed int64 // ensures close is only called once
	)
	go func() {
		<-ctx.Done()
		if conn != nil {
			ch <- ctx.Err()
			if v := atomic.AddInt64(&closed, 1); v == 1 {
				conn.Close()
			}
		}
	}()

	conn, _, err = websocket.DefaultDialer.DialContext(ctx, endpoint, nil)
	conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	if err != nil {
		return fmt.Errorf("failed to connect to ogmios, %v: %w", endpoint, err)
	}
	conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	defer func() {
		if v := atomic.AddInt64(&closed, 1); v == 1 {
			conn.Close()
		} else {
			err = <-ch
		}
	}()

	if err := conn.WriteJSON(payload); err != nil {
		return fmt.Errorf("failed to submit request: %w", err)
	}

	var raw json.RawMessage
	if err := conn.ReadJSON(&raw); err != nil {
		return fmt.Errorf("failed to read json response: %w", err)
	}

	if bytes.Contains(raw, fault) {
		var e OgmiosError
		fmt.Println(string(raw))
		if err := json.Unmarshal(raw, &e); err != nil {
			return fmt.Errorf("failed to decode error: %w", err)
		}
		return e
	}

	if v != nil {
		if err := json.Unmarshal(raw, v); err != nil {
			return fmt.Errorf("failed to unmarshal contents: %w", err)
		}
	}

	return nil
}

func makePayload(methodName string, args Map) Map {
	return Map{
		"jsonrpc": "2.0",
		"method":  methodName,
		"params": Map{
			"transaction": args,
		},
	}
}

type VKeyWitness struct {
	cbor.StructAsArray
	cbor.DecodeStoreCbor
	VKey      []byte
	Signature []byte
}

type Response struct {
	Jsonrpc string `json:"jsonrpc"`
	Method  string `json:"method"`
	Result  struct {
		Transaction struct {
			ID string `json:"id"`
		} `json:"transaction"`
	} `json:"result"`
	ID interface{} `json:"id"`
}

type OgmiosError struct {
	Jsonrpc   string `json:"jsonrpc"`
	Method    string `json:"method"`
	ErrorData struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    interface {
		} `json:"data"`
	} `json:"error"`
	ID interface{} `json:"id"`
}

func (e OgmiosError) Error() string {
	return fmt.Sprintf("%v: %v", e.ErrorData.Code, e.ErrorData.Message)
}
