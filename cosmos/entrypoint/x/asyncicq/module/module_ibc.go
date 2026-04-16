package asyncicq

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"runtime"
	"runtime/debug"
	"strings"

	errorsmod "cosmossdk.io/errors"
	storetypes "cosmossdk.io/store/types"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cosmos/cosmos-sdk/baseapp"
	sdk "github.com/cosmos/cosmos-sdk/types"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/cosmos/gogoproto/proto"
	channeltypes "github.com/cosmos/ibc-go/v10/modules/core/04-channel/types"
	porttypes "github.com/cosmos/ibc-go/v10/modules/core/05-port/types"
	ibcerrors "github.com/cosmos/ibc-go/v10/modules/core/errors"
	ibcexported "github.com/cosmos/ibc-go/v10/modules/core/exported"
)

const (
	PortID  = "icqhost"
	Version = "icq-1"

	ConsolidatedDataReportQueryPath = "/vesseloracle.vesseloracle.Query/ConsolidatedDataReport"
)

var defaultAllowQueries = []string{
	ConsolidatedDataReportQueryPath,
}

type grpcQueryRouter interface {
	Route(path string) baseapp.GRPCQueryHandler
}

type cosmosQuery struct {
	Requests []abci.RequestQuery `protobuf:"bytes,1,rep,name=requests,proto3" json:"requests"`
}

func (m *cosmosQuery) Reset()         { *m = cosmosQuery{} }
func (m *cosmosQuery) String() string { return proto.CompactTextString(m) }
func (*cosmosQuery) ProtoMessage()    {}

type cosmosResponse struct {
	Responses []abci.ResponseQuery `protobuf:"bytes,1,rep,name=responses,proto3" json:"responses"`
}

func (m *cosmosResponse) Reset()         { *m = cosmosResponse{} }
func (m *cosmosResponse) String() string { return proto.CompactTextString(m) }
func (*cosmosResponse) ProtoMessage()    {}

type interchainQueryPacketData struct {
	Data string `json:"data"`
}

type interchainQueryPacketAck struct {
	Data string `json:"data"`
}

// IBCModule implements a narrow async-ICQ host route for Entrypoint.
type IBCModule struct {
	queryRouter  grpcQueryRouter
	allowQueries map[string]struct{}
}

func NewIBCModule(queryRouter grpcQueryRouter, allowQueries []string) IBCModule {
	if len(allowQueries) == 0 {
		allowQueries = defaultAllowQueries
	}

	allow := make(map[string]struct{}, len(allowQueries))
	for _, path := range allowQueries {
		allow[path] = struct{}{}
	}

	return IBCModule{
		queryRouter:  queryRouter,
		allowQueries: allow,
	}
}

func (im IBCModule) OnChanOpenInit(
	_ sdk.Context,
	order channeltypes.Order,
	_ []string,
	portID string,
	_ string,
	_ channeltypes.Counterparty,
	version string,
) (string, error) {
	return validateHandshake(order, portID, version)
}

func (im IBCModule) OnChanOpenTry(
	_ sdk.Context,
	order channeltypes.Order,
	_ []string,
	portID string,
	_ string,
	_ channeltypes.Counterparty,
	counterpartyVersion string,
) (string, error) {
	return validateHandshake(order, portID, counterpartyVersion)
}

func (im IBCModule) OnChanOpenAck(
	_ sdk.Context,
	_ string,
	_ string,
	_ string,
	counterpartyVersion string,
) error {
	_, err := validateHandshake(channeltypes.UNORDERED, PortID, counterpartyVersion)
	return err
}

func (im IBCModule) OnChanOpenConfirm(
	_ sdk.Context,
	_ string,
	_ string,
) error {
	return nil
}

func (im IBCModule) OnChanCloseInit(
	_ sdk.Context,
	_ string,
	_ string,
) error {
	return errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "user cannot close channel")
}

func (im IBCModule) OnChanCloseConfirm(
	_ sdk.Context,
	_ string,
	_ string,
) error {
	return nil
}

func (im IBCModule) OnRecvPacket(
	ctx sdk.Context,
	_ string,
	packet channeltypes.Packet,
	_ sdk.AccAddress,
) ibcexported.Acknowledgement {
	result, err := im.executePacket(ctx, packet.GetData())
	if err != nil {
		return channeltypes.NewErrorAcknowledgement(err)
	}

	return channeltypes.NewResultAcknowledgement(result)
}

func (im IBCModule) OnAcknowledgementPacket(
	_ sdk.Context,
	_ string,
	_ channeltypes.Packet,
	_ []byte,
	_ sdk.AccAddress,
) error {
	return errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "cannot receive acknowledgement on an async-icq host channel")
}

func (im IBCModule) OnTimeoutPacket(
	_ sdk.Context,
	_ string,
	_ channeltypes.Packet,
	_ sdk.AccAddress,
) error {
	return errorsmod.Wrap(sdkerrors.ErrInvalidRequest, "cannot time out packets on an async-icq host channel")
}

func (im IBCModule) executePacket(ctx sdk.Context, packetData []byte) ([]byte, error) {
	requests, err := decodePacketRequests(packetData)
	if err != nil {
		return nil, err
	}

	responses := make([]abci.ResponseQuery, len(requests))
	err = applyFuncIfNoError(ctx, func(cacheCtx sdk.Context) error {
		executionHeight := cacheCtx.BlockHeight()
		for i, request := range requests {
			if err := im.authenticateRequest(executionHeight, request); err != nil {
				return err
			}

			handler := im.queryRouter.Route(request.Path)
			if handler == nil {
				return errorsmod.Wrapf(sdkerrors.ErrUnauthorized, "no route found for %s", request.Path)
			}

			response, err := handler(cacheCtx, &abci.RequestQuery{
				Data: request.Data,
				Path: request.Path,
			})
			if err != nil {
				return err
			}

			responses[i] = sanitizeResponse(executionHeight, response)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return encodeAcknowledgement(responses)
}

func (im IBCModule) authenticateRequest(executionHeight int64, request abci.RequestQuery) error {
	if _, ok := im.allowQueries[request.Path]; !ok {
		return errorsmod.Wrapf(sdkerrors.ErrUnauthorized, "query path not allowed: %s", request.Path)
	}

	if request.Prove {
		return errorsmod.Wrap(sdkerrors.ErrUnauthorized, "query proof not allowed")
	}

	if request.Height != 0 && request.Height != executionHeight {
		return errorsmod.Wrapf(
			sdkerrors.ErrUnauthorized,
			"query height not allowed: got %d, expected 0 or %d",
			request.Height,
			executionHeight,
		)
	}

	return nil
}

func validateHandshake(order channeltypes.Order, portID string, version string) (string, error) {
	if order != channeltypes.UNORDERED {
		return "", errorsmod.Wrapf(channeltypes.ErrInvalidChannelOrdering, "expected %s channel, got %s", channeltypes.UNORDERED, order)
	}

	if portID != PortID {
		return "", errorsmod.Wrapf(porttypes.ErrInvalidPort, "invalid port: %s, expected %s", portID, PortID)
	}

	if strings.TrimSpace(version) == "" {
		version = Version
	}

	if version != Version {
		return "", errorsmod.Wrapf(ibcerrors.ErrInvalidVersion, "invalid version: %s, expected %s", version, Version)
	}

	return Version, nil
}

func decodePacketRequests(packetData []byte) ([]abci.RequestQuery, error) {
	var wrapper interchainQueryPacketData
	if err := json.Unmarshal(packetData, &wrapper); err != nil {
		return nil, errorsmod.Wrapf(sdkerrors.ErrUnknownRequest, "cannot decode async-icq packet JSON: %v", err)
	}

	if wrapper.Data == "" {
		return nil, errorsmod.Wrap(sdkerrors.ErrUnknownRequest, "async-icq packet data is empty")
	}

	queryBytes, err := base64.StdEncoding.DecodeString(wrapper.Data)
	if err != nil {
		return nil, errorsmod.Wrapf(sdkerrors.ErrUnknownRequest, "cannot decode async-icq packet base64: %v", err)
	}

	var query cosmosQuery
	if err := proto.Unmarshal(queryBytes, &query); err != nil {
		return nil, errorsmod.Wrapf(sdkerrors.ErrUnknownRequest, "cannot decode async-icq query payload: %v", err)
	}

	if len(query.Requests) == 0 {
		return nil, errorsmod.Wrap(sdkerrors.ErrUnknownRequest, "async-icq packet must contain at least one request")
	}

	return query.Requests, nil
}

func encodeAcknowledgement(responses []abci.ResponseQuery) ([]byte, error) {
	responseBytes, err := proto.Marshal(&cosmosResponse{Responses: responses})
	if err != nil {
		return nil, errorsmod.Wrapf(sdkerrors.ErrJSONMarshal, "cannot encode async-icq response payload: %v", err)
	}

	ackBytes, err := json.Marshal(interchainQueryPacketAck{
		Data: base64.StdEncoding.EncodeToString(responseBytes),
	})
	if err != nil {
		return nil, errorsmod.Wrapf(sdkerrors.ErrJSONMarshal, "cannot encode async-icq acknowledgement: %v", err)
	}

	return ackBytes, nil
}

func sanitizeResponse(executionHeight int64, response *abci.ResponseQuery) abci.ResponseQuery {
	if response == nil {
		return abci.ResponseQuery{Height: executionHeight}
	}

	return abci.ResponseQuery{
		Code:      response.Code,
		Log:       response.Log,
		Info:      response.Info,
		Index:     response.Index,
		Key:       response.Key,
		Value:     response.Value,
		Height:    executionHeight,
		Codespace: response.Codespace,
	}
}

func applyFuncIfNoError(ctx sdk.Context, f func(ctx sdk.Context) error) (err error) {
	defer func() {
		if recoveryError := recover(); recoveryError != nil {
			if isOutOfGasError(recoveryError) {
				panic(recoveryError)
			}

			logRecoveredPanic(ctx, recoveryError)
			err = fmt.Errorf("panic occurred during async-icq execution")
		}
	}()

	// Execute queries in an isolated cache so panics/errors cannot leak partial
	// writes into the outer packet context.
	cacheCtx, write := ctx.CacheContext()
	err = f(cacheCtx)
	if err != nil {
		ctx.Logger().Error(err.Error())
		return err
	}

	// Async-ICQ execution must remain read-only even if a routed query handler
	// accidentally mutates state or emits SDK events, so the cache is never written back.
	_ = write
	return nil
}

func isOutOfGasError(err any) bool {
	switch err.(type) {
	case storetypes.ErrorOutOfGas, storetypes.ErrorGasOverflow:
		return true
	default:
		return false
	}
}

func logRecoveredPanic(ctx sdk.Context, recoveryError any) {
	stackTrace := string(debug.Stack())

	switch err := recoveryError.(type) {
	case string:
		ctx.Logger().Error("recovered string panic in async-icq host", "error", err, "stack_trace", stackTrace)
	case runtime.Error:
		ctx.Logger().Error("recovered runtime panic in async-icq host", "error", err.Error(), "stack_trace", stackTrace)
	case error:
		ctx.Logger().Error("recovered error panic in async-icq host", "error", err.Error(), "stack_trace", stackTrace)
	default:
		ctx.Logger().Error("recovered unknown panic in async-icq host", "stack_trace", stackTrace)
	}
}
