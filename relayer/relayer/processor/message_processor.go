package processor

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/cardano/relayer/v1/relayer/provider"
	sdkerrors "github.com/cosmos/cosmos-sdk/types/errors"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	ibcexported "github.com/cosmos/ibc-go/v7/modules/core/exported"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// messageProcessor is used for concurrent IBC message assembly and sending
type messageProcessor struct {
	log     *zap.Logger
	metrics *PrometheusMetrics

	memo string

	msgUpdateClient           provider.RelayerMessage
	clientUpdateThresholdTime time.Duration

	pktMsgs       []packetMessageToTrack
	connMsgs      []connectionMessageToTrack
	chanMsgs      []channelMessageToTrack
	clientICQMsgs []clientICQMessageToTrack

	isLocalhost bool
}

// catagories of tx errors for a Prometheus counter. If the error doesnt fall into one of the below categories, it is labeled as "Tx Failure"
var promErrorCatagories = []error{chantypes.ErrRedundantTx, sdkerrors.ErrInsufficientFunds, sdkerrors.ErrInvalidCoins, sdkerrors.ErrOutOfGas, sdkerrors.ErrWrongSequence}

// trackMessage stores the message tracker in the correct slice and index based on the type.
func (mp *messageProcessor) trackMessage(tracker messageToTrack, i int) {
	switch t := tracker.(type) {
	case packetMessageToTrack:
		mp.pktMsgs[i] = t
	case channelMessageToTrack:
		mp.chanMsgs[i] = t
	case connectionMessageToTrack:
		mp.connMsgs[i] = t
	case clientICQMessageToTrack:
		mp.clientICQMsgs[i] = t
	}
}

// trackers returns all of the msg trackers for the current set of messages to be sent.
func (mp *messageProcessor) trackers() (trackers []messageToTrack) {
	for _, t := range mp.pktMsgs {
		trackers = append(trackers, t)
	}
	for _, t := range mp.chanMsgs {
		trackers = append(trackers, t)
	}
	for _, t := range mp.connMsgs {
		trackers = append(trackers, t)
	}
	for _, t := range mp.clientICQMsgs {
		trackers = append(trackers, t)
	}
	return trackers
}

func newMessageProcessor(
	log *zap.Logger,
	metrics *PrometheusMetrics,
	memo string,
	clientUpdateThresholdTime time.Duration,
	isLocalhost bool,
) *messageProcessor {
	return &messageProcessor{
		log:                       log,
		metrics:                   metrics,
		memo:                      memo,
		clientUpdateThresholdTime: clientUpdateThresholdTime,
		isLocalhost:               isLocalhost,
	}
}

// processMessages is the entrypoint for the message processor.
// it will assemble and send any pending messages.
func (mp *messageProcessor) processMessages(
	ctx context.Context,
	messages pathEndMessages,
	src, dst *PathEndRuntime,
) error {
	var needsClientUpdate bool

	// Localhost IBC does not permit client updates
	if src.ClientState.ClientID != ibcexported.LocalhostClientID && dst.ClientState.ClientID != ibcexported.LocalhostConnectionID {
		var err error
		needsClientUpdate, err = mp.shouldUpdateClientNow(ctx, src, dst)
		if err != nil {
			return err
		}
		if err := mp.assembleMsgUpdateClient(ctx, src, dst); err != nil {
			return err
		}
	}

	if src.ChainProvider.Type() == "cosmos" &&
		len(messages.channelMessages)+len(messages.connectionMessages)+len(messages.packetMessages) > 0 {
		updateClient(ctx, src, dst, src.latestHeader.(provider.TendermintIBCHeader))
	}

	mp.assembleMessages(ctx, messages, src, dst)

	return mp.trackAndSendMessages(ctx, src, dst, needsClientUpdate)
}

func updateClient(ctx context.Context, src, dst *PathEndRuntime, latestHeader provider.TendermintIBCHeader) error {
	if latestHeader.Height() == dst.ClientState.ConsensusHeight.RevisionHeight {
		return nil
	}

	var msgUpdateClientHeader ibcexported.ClientMessage

	dstClientId := dst.Info.ClientID

	dsth := dst.latestBlock.Height

	dstClientState, err := dst.ChainProvider.QueryClientState(ctx, int64(dsth), dstClientId)
	if err != nil {
		return err
	}

	dstTrustedHeader, err := src.ChainProvider.QueryIBCHeader(ctx, int64(dstClientState.GetLatestHeight().GetRevisionHeight()))
	if err != nil {
		return err
	}

	msgUpdateClientHeader, err = dst.ChainProvider.MsgUpdateClientHeader(
		latestHeader,
		dstClientState.GetLatestHeight().(clienttypes.Height),
		dstTrustedHeader,
	)
	if err != nil {
		return err
	}

	msgUpdateClient, err := dst.ChainProvider.MsgUpdateClient(dstClientId, msgUpdateClientHeader)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, time.Second*10)
	defer cancel()
	dst.ChainProvider.SendMessages(ctx, []provider.RelayerMessage{
		msgUpdateClient,
	}, "")
	return nil
}

// shouldUpdateClientNow determines if an update client message should be sent
// even if there are no messages to be sent now. It will not be attempted if
// there has not been enough blocks since the last client update attempt.
// Otherwise, it will be attempted if either 2/3 of the trusting period
// or the configured client update threshold duration has passed.
func (mp *messageProcessor) shouldUpdateClientNow(ctx context.Context, src, dst *PathEndRuntime) (bool, error) {

	var consensusHeightTime time.Time

	clientConsensusHeight := dst.ClientState.ConsensusHeight
	trustedConsensusHeight := dst.ClientTrustedState.ClientState.ConsensusHeight
	if trustedConsensusHeight.EQ(clientConsensusHeight) {
		return false, nil
	}

	if dst.ClientState.ConsensusTime.IsZero() {
		var timestamp uint64
		switch src.ChainProvider.Type() {
		case "cardano":
			srcBlockData, err := src.ChainProvider.QueryBlockData(context.Background(), int64(dst.ClientState.ConsensusHeight.RevisionHeight))
			if err != nil {
				return false, fmt.Errorf("failed to get header height: %w", err)
			}
			timestamp = srcBlockData.Timestamp
			consensusHeightTime = time.Unix(int64(timestamp), 0)
		case "cosmos":
			h, err := src.ChainProvider.QueryIBCHeader(ctx, int64(dst.ClientState.ConsensusHeight.RevisionHeight))
			if err != nil {
				return false, fmt.Errorf("failed to get header height: %w", err)
			}
			timestamp = h.ConsensusState().GetTimestamp()
			consensusHeightTime = time.Unix(0, int64(timestamp))
		}
	} else {
		consensusHeightTime = dst.ClientState.ConsensusTime
	}

	clientUpdateThresholdMs := mp.clientUpdateThresholdTime.Milliseconds()

	dst.lastClientUpdateHeightMu.Lock()
	enoughBlocksPassed := (dst.latestBlock.Height - blocksToRetrySendAfter) > dst.lastClientUpdateHeight
	dst.lastClientUpdateHeightMu.Unlock()

	twoThirdsTrustingPeriodMs := float64(dst.ClientState.TrustingPeriod.Milliseconds()) * 2 / 3
	timeSinceLastClientUpdateMs := float64(time.Since(consensusHeightTime).Milliseconds())

	pastTwoThirdsTrustingPeriod := dst.ClientState.TrustingPeriod > 0 &&
		timeSinceLastClientUpdateMs > twoThirdsTrustingPeriodMs

	pastConfiguredClientUpdateThreshold := clientUpdateThresholdMs > 0 &&
		time.Since(consensusHeightTime).Milliseconds() > clientUpdateThresholdMs

	shouldUpdateClientNow := enoughBlocksPassed && (pastTwoThirdsTrustingPeriod || pastConfiguredClientUpdateThreshold)

	if mp.metrics != nil {
		timeToExpiration := dst.ClientState.TrustingPeriod - time.Since(consensusHeightTime)
		mp.metrics.SetClientExpiration(src.Info.PathName, dst.Info.ChainID, dst.ClientState.ClientID, fmt.Sprint(dst.ClientState.TrustingPeriod.String()), timeToExpiration)
		mp.metrics.SetClientTrustingPeriod(src.Info.PathName, dst.Info.ChainID, dst.Info.ClientID, time.Duration(dst.ClientState.TrustingPeriod))
	}

	if shouldUpdateClientNow {
		mp.log.Info("Client update threshold condition met",
			zap.String("path_name", src.Info.PathName),
			zap.String("chain_id", dst.Info.ChainID),
			zap.String("client_id", dst.Info.ClientID),
			zap.Int64("trusting_period", dst.ClientState.TrustingPeriod.Milliseconds()),
			zap.Int64("time_since_client_update", time.Since(consensusHeightTime).Milliseconds()),
			zap.Int64("client_threshold_time", mp.clientUpdateThresholdTime.Milliseconds()),
		)
	}

	return shouldUpdateClientNow, nil
}

// assembleMessages will assemble all messages in parallel. This typically involves proof queries for each.
func (mp *messageProcessor) assembleMessages(ctx context.Context, messages pathEndMessages, src, dst *PathEndRuntime) {
	var wg sync.WaitGroup

	if !mp.isLocalhost {
		mp.connMsgs = make([]connectionMessageToTrack, len(messages.connectionMessages))
		for i, msg := range messages.connectionMessages {
			wg.Add(1)
			go mp.assembleMessage(ctx, msg, src, dst, i, &wg)
		}
	}

	mp.chanMsgs = make([]channelMessageToTrack, len(messages.channelMessages))
	for i, msg := range messages.channelMessages {
		wg.Add(1)
		go mp.assembleMessage(ctx, msg, src, dst, i, &wg)
	}

	if !mp.isLocalhost {
		mp.clientICQMsgs = make([]clientICQMessageToTrack, len(messages.clientICQMessages))
		for i, msg := range messages.clientICQMessages {
			wg.Add(1)
			go mp.assembleMessage(ctx, msg, src, dst, i, &wg)
		}
	}

	mp.pktMsgs = make([]packetMessageToTrack, len(messages.packetMessages))
	for i, msg := range messages.packetMessages {
		wg.Add(1)
		go mp.assembleMessage(ctx, msg, src, dst, i, &wg)
	}

	wg.Wait()
}

// assembledCount will return the number of assembled messages.
// This must be called after assembleMessages has completed.
func (mp *messageProcessor) assembledCount() int {
	count := 0
	for _, m := range mp.trackers() {
		if m.assembledMsg() != nil {
			count++
		}
	}

	return count
}

// assembleMessage will assemble a specific message based on it's type.
func (mp *messageProcessor) assembleMessage(
	ctx context.Context,
	msg ibcMessage,
	src, dst *PathEndRuntime,
	i int,
	wg *sync.WaitGroup,
) {

	assembled, err := msg.assemble(ctx, src, dst)
	mp.trackMessage(msg.tracker(assembled), i)
	wg.Done()
	if err != nil {
		dst.log.Error(fmt.Sprintf("Error assembling %s message", msg.msgType()),
			zap.Object("msg", msg),
			zap.Error(err),
		)
		return
	}
	dst.log.Debug(fmt.Sprintf("Assembled %s message", msg.msgType()), zap.Object("msg", msg))
}

// assembleMsgUpdateClient uses the ChainProvider from both pathEnds to assemble the client update header
// from the source and then assemble the update client message in the correct format for the destination.
func (mp *messageProcessor) assembleMsgUpdateClient(ctx context.Context, src, dst *PathEndRuntime) error {
	clientID := dst.Info.ClientID
	clientConsensusHeight := dst.ClientState.ConsensusHeight
	trustedConsensusHeight := dst.ClientTrustedState.ClientState.ConsensusHeight
	var trustedNextValidatorsHash []byte
	//TODO: remove this comment and below
	// check clientTrustedState.IBCHeader
	if dst.ClientTrustedState.IBCHeader != nil {
		trustedNextValidatorsHash = dst.ClientTrustedState.IBCHeader.NextValidatorsHash()
	}

	var counterpartyHeader ibcexported.ClientMessage

	// If the client state height is not equal to the client trusted state height and the client state height is
	// the latest block, we cannot send a MsgUpdateClient until another block is observed on the counterparty.
	// If the client state height is in the past, beyond ibcHeadersToCache, then we need to query for it.
	if !trustedConsensusHeight.EQ(clientConsensusHeight) {
		deltaConsensusHeight := int64(clientConsensusHeight.RevisionHeight) - int64(trustedConsensusHeight.RevisionHeight)
		if trustedConsensusHeight.RevisionHeight != 0 && deltaConsensusHeight <= clientConsensusHeightUpdateThresholdBlocks {
			return fmt.Errorf("observed client trusted height: %d does not equal latest client state height: %d",
				trustedConsensusHeight.RevisionHeight, clientConsensusHeight.RevisionHeight)
		}

		switch src.ChainProvider.Type() {
		case "cardano":
			blockData, err := src.ChainProvider.QueryBlockData(ctx, int64(clientConsensusHeight.RevisionHeight+1))
			if err != nil {
				return fmt.Errorf("error getting IBC header at height: %d for chain_id: %s, %w",
					clientConsensusHeight.RevisionHeight+1, src.Info.ChainID, err)
			}

			//counterpartyHeader = blockData
			//TODO: check this condition
			//if src.latestHeader.Height() == trustedConsensusHeight.RevisionHeight &&
			//	!bytes.Equal(src.latestHeader.NextValidatorsHash(), trustedNextValidatorsHash) {
			//	return fmt.Errorf("latest header height is equal to the client trusted height: %d, "+
			//		"need to wait for next block's header before we can assemble and send a new MsgUpdateClient",
			//		trustedConsensusHeight.RevisionHeight)
			//}

			msgUpdateClient, err := dst.ChainProvider.MsgUpdateClient(clientID, blockData)
			if err != nil {
				return fmt.Errorf("error constructing MsgUpdateClient at height: %d for chain_id: %s, %w",
					clientConsensusHeight.RevisionHeight+1, src.Info.ChainID, err)
			}
			mp.msgUpdateClient = msgUpdateClient
		case "cosmos":
			header, err := src.ChainProvider.QueryIBCHeader(ctx, int64(clientConsensusHeight.RevisionHeight+1))
			if err != nil {
				return fmt.Errorf("error getting IBC header at height: %d for chain_id: %s, %w",
					clientConsensusHeight.RevisionHeight+1, src.Info.ChainID, err)
			}
			dst.ClientTrustedState = provider.ClientTrustedState{
				ClientState: dst.ClientState,
				IBCHeader:   header,
			}
			trustedConsensusHeight = clientConsensusHeight
			trustedNextValidatorsHash = header.NextValidatorsHash()
			if src.latestHeader.Height() == trustedConsensusHeight.RevisionHeight &&
				!bytes.Equal(src.latestHeader.NextValidatorsHash(), trustedNextValidatorsHash) {
				return fmt.Errorf("latest header height is equal to the client trusted height: %d, "+
					"need to wait for next block's header before we can assemble and send a new MsgUpdateClient",
					trustedConsensusHeight.RevisionHeight)
			}
			msgUpdateClientHeader, err := src.ChainProvider.MsgUpdateClientHeader(
				src.latestHeader,
				trustedConsensusHeight,
				dst.ClientTrustedState.IBCHeader,
			)
			if err != nil {
				return fmt.Errorf("error assembling new client header: %w", err)
			}
			counterpartyHeader = msgUpdateClientHeader
			msgUpdateClient, err := dst.ChainProvider.MsgUpdateClient(clientID, counterpartyHeader)
			if err != nil {
				return fmt.Errorf("error assembling MsgUpdateClient: %w", err)
			}

			mp.msgUpdateClient = msgUpdateClient
		}

		mp.log.Debug("Had to query for client trusted IBC header",
			zap.String("path_name", src.Info.PathName),
			zap.String("chain_id", src.Info.ChainID),
			zap.String("counterparty_chain_id", dst.Info.ChainID),
			zap.String("counterparty_client_id", clientID),
			zap.Uint64("height", clientConsensusHeight.RevisionHeight+1),
			zap.Uint64("latest_height", src.latestBlock.Height),
		)
	}

	return nil
}

// trackAndSendMessages will increment attempt counters for each message and send each message.
// Messages will be batched if the broadcast mode is configured to 'batch' and there was not an error
// in a previous batch.
func (mp *messageProcessor) trackAndSendMessages(
	ctx context.Context,
	src, dst *PathEndRuntime,
	needsClientUpdate bool,
) error {
	broadcastBatch := dst.ChainProvider.ProviderConfig().BroadcastMode() == provider.BroadcastModeBatch
	var batch []messageToTrack

	for _, t := range mp.trackers() {

		retries := dst.trackProcessingMessage(t)
		if t.assembledMsg() == nil {
			continue
		}

		ordered := false
		if m, ok := t.(packetMessageToTrack); ok && m.msg.info.ChannelOrder == chantypes.ORDERED.String() {
			ordered = true
		}

		if broadcastBatch && (retries == 0 || ordered) {
			batch = append(batch, t)
			continue
		}
		go mp.sendSingleMessage(ctx, src, dst, t)
	}

	if len(batch) > 0 {
		go mp.sendBatchMessages(ctx, src, dst, batch)
	}

	if mp.assembledCount() > 0 {
		return nil
	}

	if needsClientUpdate {
		go mp.sendClientUpdate(ctx, src, dst)
		return nil
	}

	// only msgUpdateClient, don't need to send
	return errors.New("all messages failed to assemble")
}

// sendClientUpdate will send an isolated client update message.
func (mp *messageProcessor) sendClientUpdate(
	ctx context.Context,
	src, dst *PathEndRuntime,
) {
	broadcastCtx, cancel := context.WithTimeout(ctx, messageSendTimeout)
	defer cancel()

	dst.log.Debug("Will relay client update")

	dst.lastClientUpdateHeightMu.Lock()
	dst.lastClientUpdateHeight = dst.latestBlock.Height
	dst.lastClientUpdateHeightMu.Unlock()

	msgs := []provider.RelayerMessage{mp.msgUpdateClient}
	if err := dst.ChainProvider.SendMessagesToMempool(broadcastCtx, msgs, mp.memo, ctx, nil); err != nil {
		mp.log.Error("Error sending client update message",
			zap.String("path_name", src.Info.PathName),
			zap.String("src_chain_id", src.Info.ChainID),
			zap.String("dst_chain_id", dst.Info.ChainID),
			zap.String("src_client_id", src.Info.ClientID),
			zap.String("dst_client_id", dst.Info.ClientID),
			zap.Error(err),
		)

		for _, promError := range promErrorCatagories {
			if mp.metrics != nil {
				if errors.Is(err, promError) {
					mp.metrics.IncTxFailure(src.Info.PathName, src.Info.ChainID, promError.Error())
				} else {
					mp.metrics.IncTxFailure(src.Info.PathName, src.Info.ChainID, "Tx Failure")
				}
			}
		}
		return
	}
	dst.log.Debug("Client update broadcast completed")
}

type PathProcessorMessageResp struct {
	Response         *provider.RelayerTxResponse
	DestinationChain provider.ChainProvider
	SuccessfulTx     bool
	Error            error
}

var PathProcMessageCollector chan *PathProcessorMessageResp

// sendBatchMessages will send a batch of messages,
// then increment metrics counters for successful packet messages.
func (mp *messageProcessor) sendBatchMessages(
	ctx context.Context,
	src, dst *PathEndRuntime,
	batch []messageToTrack,
) {
	broadcastCtx, cancel := context.WithTimeout(ctx, messageSendTimeout)
	defer cancel()

	var (
		msgs   []provider.RelayerMessage
		fields []zapcore.Field
	)

	if mp.isLocalhost {
		for i, t := range batch {
			msgs[i] = t.assembledMsg()
			fields = append(fields, zap.Object(fmt.Sprintf("msg_%d", i), t))
		}
	} else {
		startIndex := 0

		if mp.msgUpdateClient != nil {
			msgs = make([]provider.RelayerMessage, 1+len(batch))
			msgs[0] = mp.msgUpdateClient
			startIndex = 1
		} else {
			msgs = make([]provider.RelayerMessage, len(batch))
		}

		for i, t := range batch {
			msgs[startIndex+i] = t.assembledMsg()
			fields = append(fields, zap.Object(fmt.Sprintf("msg_%d", i), t))
		}
	}

	dst.log.Debug("Will relay messages", fields...)

	callback := func(_ *provider.RelayerTxResponse, err error) {
		// only increment metrics counts for successful packets
		if err != nil || mp.metrics == nil {
			return
		}
		for _, tracker := range batch {
			t, ok := tracker.(packetMessageToTrack)
			if !ok {
				continue
			}
			var channel, port string
			if t.msg.eventType == chantypes.EventTypeRecvPacket {
				channel = t.msg.info.DestChannel
				port = t.msg.info.DestPort
			} else {
				channel = t.msg.info.SourceChannel
				port = t.msg.info.SourcePort
			}
			mp.metrics.IncPacketsRelayed(dst.Info.PathName, dst.Info.ChainID, channel, port, t.msg.eventType)
		}
	}
	callbacks := []func(rtr *provider.RelayerTxResponse, err error){callback}

	//During testing, this adds a callback so our test case can inspect the TX results
	if PathProcMessageCollector != nil {
		testCallback := func(rtr *provider.RelayerTxResponse, err error) {
			msgResult := &PathProcessorMessageResp{
				DestinationChain: dst.ChainProvider,
				Response:         rtr,
				SuccessfulTx:     err == nil,
				Error:            err,
			}
			PathProcMessageCollector <- msgResult
		}
		callbacks = append(callbacks, testCallback)
	}
	if err := dst.ChainProvider.SendMessagesToMempool(broadcastCtx, msgs, mp.memo, ctx, callbacks); err != nil {
		errFields := []zapcore.Field{
			zap.String("path_name", src.Info.PathName),
			zap.String("src_chain_id", src.Info.ChainID),
			zap.String("dst_chain_id", dst.Info.ChainID),
			zap.String("src_client_id", src.Info.ClientID),
			zap.String("dst_client_id", dst.Info.ClientID),
			zap.Error(err),
		}

		for _, promError := range promErrorCatagories {
			if mp.metrics != nil {
				if errors.Is(err, promError) {
					mp.metrics.IncTxFailure(src.Info.PathName, src.Info.ChainID, promError.Error())
				} else {
					mp.metrics.IncTxFailure(src.Info.PathName, src.Info.ChainID, "Tx Failure")
				}
			}
		}

		if errors.Is(err, chantypes.ErrRedundantTx) {
			mp.log.Debug("Redundant message(s)", errFields...)
			return
		}
		mp.log.Error("Error sending messages", errFields...)
		return
	}
	dst.log.Debug("Message broadcast completed", fields...)
}

// sendSingleMessage will send an isolated message.
func (mp *messageProcessor) sendSingleMessage(
	ctx context.Context,
	src, dst *PathEndRuntime,
	tracker messageToTrack,
) {
	var msgs []provider.RelayerMessage

	if mp.isLocalhost {
		msgs = []provider.RelayerMessage{tracker.assembledMsg()}
	} else {
		if mp.msgUpdateClient != nil {
			msgs = []provider.RelayerMessage{mp.msgUpdateClient, tracker.assembledMsg()}
		} else {
			msgs = []provider.RelayerMessage{tracker.assembledMsg()}
		}
	}

	broadcastCtx, cancel := context.WithTimeout(ctx, messageSendTimeout)
	defer cancel()

	msgType := tracker.msgType()

	dst.log.Debug(fmt.Sprintf("Will broadcast %s message", msgType), zap.Object("msg", tracker))

	// Set callback for packet messages so that we increment prometheus metrics on successful relays.
	callbacks := []func(rtr *provider.RelayerTxResponse, err error){}
	if t, ok := tracker.(packetMessageToTrack); ok {
		callback := func(_ *provider.RelayerTxResponse, err error) {
			// only increment metrics counts for successful packets
			if err != nil || mp.metrics == nil {
				return
			}
			var channel, port string
			if t.msg.eventType == chantypes.EventTypeRecvPacket {
				channel = t.msg.info.DestChannel
				port = t.msg.info.DestPort
			} else {
				channel = t.msg.info.SourceChannel
				port = t.msg.info.SourcePort
			}
			mp.metrics.IncPacketsRelayed(dst.Info.PathName, dst.Info.ChainID, channel, port, t.msg.eventType)
		}

		callbacks = append(callbacks, callback)
	}

	//During testing, this adds a callback so our test case can inspect the TX results
	if PathProcMessageCollector != nil {
		testCallback := func(rtr *provider.RelayerTxResponse, err error) {
			msgResult := &PathProcessorMessageResp{
				DestinationChain: dst.ChainProvider,
				Response:         rtr,
				SuccessfulTx:     err == nil,
				Error:            err,
			}
			PathProcMessageCollector <- msgResult
		}
		callbacks = append(callbacks, testCallback)
	}
	err := dst.ChainProvider.SendMessagesToMempool(broadcastCtx, msgs, mp.memo, ctx, callbacks)
	if err != nil {
		errFields := []zapcore.Field{
			zap.String("path_name", src.Info.PathName),
			zap.String("src_chain_id", src.Info.ChainID),
			zap.String("dst_chain_id", dst.Info.ChainID),
			zap.String("src_client_id", src.Info.ClientID),
			zap.String("dst_client_id", dst.Info.ClientID),
		}

		for _, promError := range promErrorCatagories {
			if mp.metrics != nil {
				if errors.Is(err, promError) {
					mp.metrics.IncTxFailure(src.Info.PathName, src.Info.ChainID, promError.Error())
				} else {
					mp.metrics.IncTxFailure(src.Info.PathName, src.Info.ChainID, "Tx Failure")
				}
			}
		}

		errFields = append(errFields, zap.Object("msg", tracker))
		errFields = append(errFields, zap.Error(err))
		if errors.Is(err, chantypes.ErrRedundantTx) {
			mp.log.Debug(fmt.Sprintf("Redundant %s message", msgType), errFields...)
			return
		}
		mp.log.Error(fmt.Sprintf("Error broadcasting %s message", msgType), errFields...)
		return
	}

	dst.log.Debug(fmt.Sprintf("Successfully broadcasted %s message", msgType), zap.Object("msg", tracker))
}
