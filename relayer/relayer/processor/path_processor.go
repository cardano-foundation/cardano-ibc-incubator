package processor

import (
	"context"
	"fmt"
	"time"

	"github.com/cardano/relayer/v1/relayer/provider"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	ibcexported "github.com/cosmos/ibc-go/v7/modules/core/exported"
	"go.uber.org/zap"
)

const (
	// durationErrorRetry determines how long to wait before retrying
	// in the case of failure to send transactions with IBC messages.
	durationErrorRetry = 5 * time.Second

	// Amount of time to wait when sending transactions before giving up
	// and continuing on. Messages will be retried later if they are still
	// relevant.
	messageSendTimeout = 60 * time.Second

	// Amount of time to wait for a proof to be queried before giving up.
	// The proof query will be retried later if the message still needs
	// to be relayed.
	packetProofQueryTimeout = 5 * time.Second

	// Amount of time to wait for interchain queries.
	interchainQueryTimeout = 60 * time.Second

	// Amount of time between flushes if the previous flush failed.
	flushFailureRetry = 5 * time.Second

	// If message assembly fails from either proof query failure on the source
	// or assembling the message for the destination, how many blocks should pass
	// before retrying.
	blocksToRetryAssemblyAfter = 0

	// If the message was assembled successfully, but sending the message failed,
	// how many blocks should pass before retrying.
	blocksToRetrySendAfter = 5

	// How many times to retry sending a message before giving up on it.
	maxMessageSendRetries = 5

	// How many blocks of history to retain ibc headers in the cache for.
	ibcHeadersToCache = 10

	// How many blocks of history before determining that a query needs to be
	// made to retrieve the client consensus state in order to assemble a
	// MsgUpdateClient message.
	clientConsensusHeightUpdateThresholdBlocks = 2
)

// PathProcessor is a process that handles incoming IBC messages from a pair of chains.
// It determines what messages need to be relayed, and sends them.
type PathProcessor struct {
	log *zap.Logger

	PathEnd1 *PathEndRuntime
	PathEnd2 *PathEndRuntime

	memo string

	clientUpdateThresholdTime time.Duration

	messageLifecycle MessageLifecycle

	initialFlushComplete bool
	flushTimer           *time.Timer
	flushInterval        time.Duration

	// Signals to retry.
	retryProcess chan struct{}

	sentInitialMsg bool

	// true if this is a localhost IBC connection
	isLocalhost bool

	maxMsgs uint64

	metrics *PrometheusMetrics
}

// PathProcessors is a slice of PathProcessor instances
type PathProcessors []*PathProcessor

func (p PathProcessors) IsRelayedChannel(k ChannelKey, chainID string) bool {
	for _, pp := range p {
		if pp.IsRelayedChannel(chainID, k) {
			return true
		}
	}
	return false
}

func NewPathProcessor(
	log *zap.Logger,
	pathEnd1 PathEnd,
	pathEnd2 PathEnd,
	metrics *PrometheusMetrics,
	memo string,
	clientUpdateThresholdTime time.Duration,
	flushInterval time.Duration,
	maxMsgs uint64,
) *PathProcessor {
	isLocalhost := pathEnd1.ClientID == ibcexported.LocalhostClientID

	pp := &PathProcessor{
		log:                       log,
		PathEnd1:                  newPathEndRuntime(log, pathEnd1, metrics),
		PathEnd2:                  newPathEndRuntime(log, pathEnd2, metrics),
		retryProcess:              make(chan struct{}, 2),
		memo:                      memo,
		clientUpdateThresholdTime: clientUpdateThresholdTime,
		flushInterval:             flushInterval,
		metrics:                   metrics,
		isLocalhost:               isLocalhost,
		maxMsgs:                   maxMsgs,
	}
	if flushInterval == 0 {
		pp.disablePeriodicFlush()
	}
	return pp
}

// disablePeriodicFlush will "disable" periodic flushing by using a large value.
func (pp *PathProcessor) disablePeriodicFlush() {
	pp.flushInterval = 200 * 24 * 365 * time.Hour
}

func (pp *PathProcessor) SetMessageLifecycle(messageLifecycle MessageLifecycle) {
	pp.messageLifecycle = messageLifecycle
	if !pp.shouldFlush() {
		// disable flushing when termination conditions are set, e.g. connection/channel handshakes
		pp.disablePeriodicFlush()
	}
}

func (pp *PathProcessor) shouldFlush() bool {
	if pp.messageLifecycle == nil {
		return true
	}
	if _, ok := pp.messageLifecycle.(*FlushLifecycle); ok {
		return true
	}
	return false
}

// TEST USE ONLY
func (pp *PathProcessor) PathEnd1Messages(channelKey ChannelKey, message string) PacketSequenceCache {
	return pp.PathEnd1.messageCache.PacketFlow[channelKey][message]
}

// TEST USE ONLY
func (pp *PathProcessor) PathEnd2Messages(channelKey ChannelKey, message string) PacketSequenceCache {
	return pp.PathEnd2.messageCache.PacketFlow[channelKey][message]
}

type channelPair struct {
	pathEnd1ChannelKey ChannelKey
	pathEnd2ChannelKey ChannelKey
}

// RelevantClientID returns the relevant client ID or panics
func (pp *PathProcessor) RelevantClientID(chainID string) string {
	if pp.PathEnd1.Info.ChainID == chainID {
		return pp.PathEnd1.Info.ClientID
	}
	if pp.PathEnd2.Info.ChainID == chainID {
		return pp.PathEnd2.Info.ClientID
	}
	panic(fmt.Errorf("no relevant client ID for chain ID: %s", chainID))
}

// OnConnectionMessage allows the caller to handle connection handshake messages with a callback.
func (pp *PathProcessor) OnConnectionMessage(chainID string, eventType string, onMsg func(provider.ConnectionInfo)) {
	if pp.PathEnd1.Info.ChainID == chainID {
		pp.PathEnd1.connSubscribers[eventType] = append(pp.PathEnd1.connSubscribers[eventType], onMsg)
	} else if pp.PathEnd2.Info.ChainID == chainID {
		pp.PathEnd2.connSubscribers[eventType] = append(pp.PathEnd2.connSubscribers[eventType], onMsg)
	}
}

func (pp *PathProcessor) channelPairs() []channelPair {
	// Channel keys are from pathEnd1's perspective
	channels := make(map[ChannelKey]ChannelState)
	for k, cs := range pp.PathEnd1.channelStateCache {
		channels[k] = cs
	}
	for k, cs := range pp.PathEnd2.channelStateCache {
		channels[k.Counterparty()] = cs
	}
	pairs := make([]channelPair, len(channels))
	i := 0
	for k := range channels {
		pairs[i] = channelPair{
			pathEnd1ChannelKey: k,
			pathEnd2ChannelKey: k.Counterparty(),
		}
		i++
	}
	return pairs
}

// Path Processors are constructed before ChainProcessors, so reference needs to be added afterwards
// This can be done inside the ChainProcessor constructor for simplification
func (pp *PathProcessor) SetChainProviderIfApplicable(chainProvider provider.ChainProvider) bool {
	if chainProvider == nil {
		return false
	}
	if pp.PathEnd1.Info.ChainID == chainProvider.ChainId() {
		pp.PathEnd1.ChainProvider = chainProvider

		if pp.isLocalhost {
			pp.PathEnd2.ChainProvider = chainProvider
		}

		return true
	} else if pp.PathEnd2.Info.ChainID == chainProvider.ChainId() {
		pp.PathEnd2.ChainProvider = chainProvider

		if pp.isLocalhost {
			pp.PathEnd1.ChainProvider = chainProvider
		}

		return true
	}
	return false
}

func (pp *PathProcessor) IsRelayedChannel(chainID string, channelKey ChannelKey) bool {
	if pp.PathEnd1.Info.ChainID == chainID {
		return pp.PathEnd1.Info.ShouldRelayChannel(ChainChannelKey{ChainID: chainID, CounterpartyChainID: pp.PathEnd2.Info.ChainID, ChannelKey: channelKey})
	} else if pp.PathEnd2.Info.ChainID == chainID {
		return pp.PathEnd2.Info.ShouldRelayChannel(ChainChannelKey{ChainID: chainID, CounterpartyChainID: pp.PathEnd1.Info.ChainID, ChannelKey: channelKey})
	}
	return false
}

func (pp *PathProcessor) IsRelevantClient(chainID string, clientID string) bool {
	if pp.PathEnd1.Info.ChainID == chainID {
		return pp.PathEnd1.Info.ClientID == clientID
	} else if pp.PathEnd2.Info.ChainID == chainID {
		return pp.PathEnd2.Info.ClientID == clientID
	}
	return false
}

func (pp *PathProcessor) IsRelevantConnection(chainID string, connectionID string) bool {
	if pp.PathEnd1.Info.ChainID == chainID {
		return pp.PathEnd1.isRelevantConnection(connectionID)
	} else if pp.PathEnd2.Info.ChainID == chainID {
		return pp.PathEnd2.isRelevantConnection(connectionID)
	}
	return false
}

func (pp *PathProcessor) IsRelevantChannel(chainID string, channelID string) bool {
	if pp.PathEnd1.Info.ChainID == chainID {
		return pp.PathEnd1.isRelevantChannel(channelID)
	} else if pp.PathEnd2.Info.ChainID == chainID {
		return pp.PathEnd2.isRelevantChannel(channelID)
	}
	return false
}

// ProcessBacklogIfReady gives ChainProcessors a way to trigger the path processor process
// as soon as they are in sync for the first time, even if they do not have new messages.
func (pp *PathProcessor) ProcessBacklogIfReady() {
	select {
	case pp.retryProcess <- struct{}{}:
		// All good.
	default:
		// Log that the channel is saturated;
		// something is wrong if we are retrying this quickly.
		pp.log.Error("Failed to enqueue path processor retry, retries already scheduled")
	}
}

// ChainProcessors call this method when they have new IBC messages
func (pp *PathProcessor) HandleNewData(chainID string, cacheData ChainProcessorCacheData) {
	if pp.isLocalhost {
		pp.handleLocalhostData(cacheData)
		return
	}

	if pp.PathEnd1.Info.ChainID == chainID {
		pp.PathEnd1.incomingCacheData <- cacheData
	} else if pp.PathEnd2.Info.ChainID == chainID {
		pp.PathEnd2.incomingCacheData <- cacheData
	}
}

func (pp *PathProcessor) handleFlush(ctx context.Context) {
	flushTimer := pp.flushInterval
	if err := pp.flush(ctx); err != nil {
		pp.log.Warn("Flush not complete", zap.Error(err))
		flushTimer = flushFailureRetry
	}
	pp.flushTimer.Stop()
	pp.flushTimer = time.NewTimer(flushTimer)
}

// processAvailableSignals will block if signals are not yet available, otherwise it will process one of the available signals.
// It returns whether or not the pathProcessor should quit.
func (pp *PathProcessor) processAvailableSignals(ctx context.Context, cancel func()) bool {
	select {
	case <-ctx.Done():
		pp.log.Debug("Context done, quitting PathProcessor",
			zap.String("chain_id_1", pp.PathEnd1.Info.ChainID),
			zap.String("chain_id_2", pp.PathEnd2.Info.ChainID),
			zap.String("client_id_1", pp.PathEnd1.Info.ClientID),
			zap.String("client_id_2", pp.PathEnd2.Info.ClientID),
			zap.Error(ctx.Err()),
		)
		return true
	case d := <-pp.PathEnd1.incomingCacheData:
		if len(d.IBCMessagesCache.ConnectionHandshake) > 0 {
			fmt.Println("d := <-pp.PathEnd1.incomingCacheData", d.IBCMessagesCache.ConnectionHandshake)
		}
		// we have new data from ChainProcessor for pathEnd1
		pp.PathEnd1.mergeCacheData(ctx, cancel, d, pp.PathEnd2.Info.ChainID, pp.PathEnd2.inSync, pp.messageLifecycle, pp.PathEnd2)

	case d := <-pp.PathEnd2.incomingCacheData:
		if len(d.IBCMessagesCache.ConnectionHandshake) > 0 {
			fmt.Println("d := <-pp.PathEnd2.incomingCacheData", d.IBCMessagesCache.ConnectionHandshake)
		}
		// we have new data from ChainProcessor for pathEnd2
		pp.PathEnd2.mergeCacheData(ctx, cancel, d, pp.PathEnd1.Info.ChainID, pp.PathEnd1.inSync, pp.messageLifecycle, pp.PathEnd1)

	case <-pp.retryProcess:
		// No new data to merge in, just retry handling.
	case <-pp.flushTimer.C:
		// Periodic flush to clear out any old packets
		pp.handleFlush(ctx)
	}
	return false
}

// Run executes the main path process.
func (pp *PathProcessor) Run(ctx context.Context, cancel func()) {
	var retryTimer *time.Timer

	pp.flushTimer = time.NewTimer(time.Hour)

	for {
		// block until we have any signals to process
		if pp.processAvailableSignals(ctx, cancel) {
			return
		}

		for len(pp.PathEnd1.incomingCacheData) > 0 || len(pp.PathEnd2.incomingCacheData) > 0 || len(pp.retryProcess) > 0 {
			// signals are available, so this will not need to block.
			if pp.processAvailableSignals(ctx, cancel) {
				return
			}
		}

		if !pp.PathEnd1.inSync || !pp.PathEnd2.inSync {
			continue
		}

		//if pp.shouldFlush() && !pp.initialFlushComplete {
		//	pp.handleFlush(ctx)
		//	pp.initialFlushComplete = true
		//} else if pp.shouldTerminateForFlushComplete() {
		//	cancel()
		//	return
		//}

		// process latest message cache state from both pathEnds
		if err := pp.processLatestMessages(ctx, cancel); err != nil {
			// in case of IBC message send errors, schedule retry after durationErrorRetry
			if retryTimer != nil {
				retryTimer.Stop()
			}
			if ctx.Err() == nil {
				retryTimer = time.AfterFunc(durationErrorRetry, pp.ProcessBacklogIfReady)
			}
		}
	}
}

func (pp *PathProcessor) handleLocalhostData(cacheData ChainProcessorCacheData) {
	pathEnd1Cache := ChainProcessorCacheData{
		IBCMessagesCache:     NewIBCMessagesCache(),
		InSync:               cacheData.InSync,
		ClientState:          cacheData.ClientState,
		ConnectionStateCache: cacheData.ConnectionStateCache,
		ChannelStateCache:    cacheData.ChannelStateCache,
		LatestBlock:          cacheData.LatestBlock,
		LatestHeader:         cacheData.LatestHeader,
		IBCHeaderCache:       cacheData.IBCHeaderCache,
	}
	pathEnd2Cache := ChainProcessorCacheData{
		IBCMessagesCache:     NewIBCMessagesCache(),
		InSync:               cacheData.InSync,
		ClientState:          cacheData.ClientState,
		ConnectionStateCache: cacheData.ConnectionStateCache,
		ChannelStateCache:    cacheData.ChannelStateCache,
		LatestBlock:          cacheData.LatestBlock,
		LatestHeader:         cacheData.LatestHeader,
		IBCHeaderCache:       cacheData.IBCHeaderCache,
	}

	// split up data and send lower channel-id data to pathEnd1 and higher channel-id data to pathEnd2.
	for k, v := range cacheData.IBCMessagesCache.PacketFlow {
		chan1, err := chantypes.ParseChannelSequence(k.ChannelID)
		if err != nil {
			pp.log.Error("Failed to parse channel ID int from string", zap.Error(err))
			continue
		}

		chan2, err := chantypes.ParseChannelSequence(k.CounterpartyChannelID)
		if err != nil {
			pp.log.Error("Failed to parse channel ID int from string", zap.Error(err))
			continue
		}

		if chan1 < chan2 {
			pathEnd1Cache.IBCMessagesCache.PacketFlow[k] = v
		} else {
			pathEnd2Cache.IBCMessagesCache.PacketFlow[k] = v
		}
	}

	for eventType, c := range cacheData.IBCMessagesCache.ChannelHandshake {
		for k, v := range c {
			switch eventType {
			case chantypes.EventTypeChannelOpenInit, chantypes.EventTypeChannelOpenAck, chantypes.EventTypeChannelCloseInit:
				if _, ok := pathEnd1Cache.IBCMessagesCache.ChannelHandshake[eventType]; !ok {
					pathEnd1Cache.IBCMessagesCache.ChannelHandshake[eventType] = make(ChannelMessageCache)
				}
				if order, ok := pp.PathEnd1.channelOrderCache[k.ChannelID]; ok {
					v.Order = order
				}
				if order, ok := pp.PathEnd2.channelOrderCache[k.CounterpartyChannelID]; ok {
					v.Order = order
				}
				// TODO this is insanely hacky, need to figure out how to handle the ordering dilemma on ordered chans
				if v.Order == chantypes.NONE {
					v.Order = chantypes.ORDERED
				}
				pathEnd1Cache.IBCMessagesCache.ChannelHandshake[eventType][k] = v
			case chantypes.EventTypeChannelOpenTry, chantypes.EventTypeChannelOpenConfirm, chantypes.EventTypeChannelCloseConfirm:
				if _, ok := pathEnd2Cache.IBCMessagesCache.ChannelHandshake[eventType]; !ok {
					pathEnd2Cache.IBCMessagesCache.ChannelHandshake[eventType] = make(ChannelMessageCache)
				}
				if order, ok := pp.PathEnd2.channelOrderCache[k.ChannelID]; ok {
					v.Order = order
				}
				if order, ok := pp.PathEnd1.channelOrderCache[k.CounterpartyChannelID]; ok {
					v.Order = order
				}

				pathEnd2Cache.IBCMessagesCache.ChannelHandshake[eventType][k] = v
			default:
				pp.log.Error("Invalid IBC channel event type", zap.String("event_type", eventType))
			}
		}
	}

	channelStateCache1 := make(map[ChannelKey]ChannelState)
	channelStateCache2 := make(map[ChannelKey]ChannelState)

	// split up data and send lower channel-id data to pathEnd2 and higher channel-id data to pathEnd1.
	for k, v := range cacheData.ChannelStateCache {
		chan1, err := chantypes.ParseChannelSequence(k.ChannelID)
		chan2, secErr := chantypes.ParseChannelSequence(k.CounterpartyChannelID)

		if err != nil && secErr != nil {
			continue
		}

		// error parsing counterparty chan ID so write chan state to src cache.
		// this should indicate that the chan handshake has not progressed past the TRY so,
		// counterparty chan id has not been initialized yet.
		if secErr != nil && err == nil {
			channelStateCache1[k] = v
			continue
		}

		if chan1 > chan2 {
			channelStateCache2[k] = v
		} else {
			channelStateCache1[k] = v
		}
	}

	pathEnd1Cache.ChannelStateCache = channelStateCache1
	pathEnd2Cache.ChannelStateCache = channelStateCache2

	pp.PathEnd1.incomingCacheData <- pathEnd1Cache
	pp.PathEnd2.incomingCacheData <- pathEnd2Cache
}
