package cardano

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/cardano/relayer/v1/relayer/chains/cosmos/mithril"

	"github.com/avast/retry-go/v4"
	"github.com/cardano/relayer/v1/relayer/processor"
	"github.com/cardano/relayer/v1/relayer/provider"
	ctypes "github.com/cometbft/cometbft/rpc/core/types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	conntypes "github.com/cosmos/ibc-go/v7/modules/core/03-connection/types"
	chantypes "github.com/cosmos/ibc-go/v7/modules/core/04-channel/types"
	tmclient "github.com/cosmos/ibc-go/v7/modules/light-clients/07-tendermint"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
)

type CardanoChainProcessor struct {
	log            *zap.Logger
	chainProvider  *CardanoProvider
	pathProcessors processor.PathProcessors
	inSync         bool
	latestBlock    provider.LatestBlock
	latestClientState
	connectionStateCache processor.ConnectionStateCache
	channelStateCache    processor.ChannelStateCache
	connectionClients    map[string]string
	channelConnections   map[string]string
	//metrics              *processor.PrometheusMetrics
}

func NewCardanoChainProcessor(log *zap.Logger, provider *CardanoProvider, metrics *processor.PrometheusMetrics) *CardanoChainProcessor {
	return &CardanoChainProcessor{
		log:                  log.With(zap.String("chain_name", provider.ChainName()), zap.String("chain_id", provider.ChainId())),
		chainProvider:        provider,
		latestClientState:    make(latestClientState),
		connectionStateCache: make(processor.ConnectionStateCache),
		channelStateCache:    make(processor.ChannelStateCache),
		connectionClients:    make(map[string]string),
		channelConnections:   make(map[string]string),
		//metrics:              metrics,
	}
}

// latestClientState is a map of clientID to the latest clientInfo for that client.
type latestClientState map[string]provider.ClientState

func (l latestClientState) update(ctx context.Context, clientInfo clientInfo, ccp *CardanoChainProcessor) {
	existingClientInfo, ok := l[clientInfo.clientID]
	var trustingPeriod time.Duration
	if ok {
		if clientInfo.consensusHeight.LT(existingClientInfo.ConsensusHeight) {
			// height is less than latest, so no-op
			return
		}
		trustingPeriod = existingClientInfo.TrustingPeriod
	}
	if trustingPeriod == 0 {
		cs, err := ccp.clientState(ctx, clientInfo.clientID)
		if err != nil {
			ccp.log.Error(
				"Failed to query client state to get trusting period",
				zap.String("client_id", clientInfo.clientID),
				zap.Error(err),
			)
			return
		}
		trustingPeriod = cs.TrustingPeriod
	}
	clientState := clientInfo.ClientState(trustingPeriod)
	l[clientInfo.clientID] = clientState
}

const (
	queryTimeout                = 5 * time.Second
	blockResultsQueryTimeout    = 2 * time.Minute
	latestHeightQueryRetryDelay = 1 * time.Second
	latestHeightQueryRetries    = 5

	defaultMinQueryLoopDuration = 1 * time.Second
	inSyncNumBlocksThreshold    = 2
)

func (ccp *CardanoChainProcessor) Provider() provider.ChainProvider {
	return ccp.chainProvider
}

func (ccp *CardanoChainProcessor) SetPathProcessors(pathProcessors processor.PathProcessors) {
	ccp.pathProcessors = pathProcessors
}

type queryCyclePersistence struct {
	latestHeight         int64
	latestQueriedBlock   int64
	minQueryLoopDuration time.Duration
}

func (ccp *CardanoChainProcessor) Run(ctx context.Context, initialBlockHistory uint64) error {
	minQueryLoopDuration := ccp.chainProvider.PCfg.MinLoopDuration
	if minQueryLoopDuration == 0 {
		minQueryLoopDuration = defaultMinQueryLoopDuration
	}
	persistence := queryCyclePersistence{
		minQueryLoopDuration: minQueryLoopDuration,
	}
	for {
		latestHeight, err := ccp.latestHeightWithRetry(ctx)
		if err != nil {
			ccp.log.Error(
				"Failed to query latest height after max attempts",
				zap.Uint("attempts", latestHeightQueryRetries),
				zap.Error(err),
			)
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return nil
			}
			continue
		}
		persistence.latestHeight = latestHeight
		break
	}
	// this will make initial QueryLoop iteration look back initialBlockHistory blocks in history
	latestQueriedBlock := persistence.latestHeight - 15

	if latestQueriedBlock < 0 {
		latestQueriedBlock = 0
	}

	persistence.latestQueriedBlock = latestQueriedBlock

	var eg errgroup.Group
	eg.Go(func() error {
		return ccp.initializeConnectionState(ctx)
	})
	eg.Go(func() error {
		return ccp.initializeChannelState(ctx)
	})
	if err := eg.Wait(); err != nil {
		return err
	}

	ccp.log.Debug("Entering main query loop")
	ticker := time.NewTicker(persistence.minQueryLoopDuration)
	defer ticker.Stop()

	for {
		if err := ccp.queryCycle(ctx, &persistence); err != nil {
			return err
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			ticker.Reset(persistence.minQueryLoopDuration)
		}
	}
}

func (ccp *CardanoChainProcessor) latestHeightWithRetry(ctx context.Context) (latestHeight int64, err error) {
	return latestHeight, retry.Do(func() error {
		var err error
		latestHeight, err = ccp.chainProvider.QueryLatestHeight(ctx)
		return err
	}, retry.Context(ctx), retry.Attempts(latestHeightQueryRetries), retry.Delay(latestHeightQueryRetryDelay), retry.LastErrorOnly(true), retry.OnRetry(func(n uint, err error) {
		ccp.log.Info(
			"Failed to query latest height",
			zap.Uint("attempt", n+1),
			zap.Uint("max_attempts", latestHeightQueryRetries),
			zap.Error(err),
		)
	}))
}

func (ccp *CardanoChainProcessor) initializeConnectionState(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	connections, err := ccp.chainProvider.QueryConnections(ctx)
	if err != nil {
		return fmt.Errorf("error querying connections: %w", err)
	}
	for _, c := range connections {
		ccp.connectionClients[c.Id] = c.ClientId
		ccp.connectionStateCache[processor.ConnectionKey{
			ConnectionID:         c.Id,
			ClientID:             c.ClientId,
			CounterpartyConnID:   c.Counterparty.ConnectionId,
			CounterpartyClientID: c.Counterparty.ClientId,
		}] = c.State == conntypes.OPEN
	}
	return nil
}

func (ccp *CardanoChainProcessor) initializeChannelState(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	channels, err := ccp.chainProvider.QueryChannels(ctx)
	if err != nil {
		return fmt.Errorf("error querying channels: %w", err)
	}
	for _, ch := range channels {
		if len(ch.ConnectionHops) != 1 {
			ccp.log.Error("Found channel using multiple connection hops. Not currently supported, ignoring.",
				zap.String("channel_id", ch.ChannelId),
				zap.String("port_id", ch.PortId),
				zap.Any("connection_hops", ch.ConnectionHops),
			)
			continue
		}
		ccp.channelConnections[ch.ChannelId] = ch.ConnectionHops[0]
		k := processor.ChannelKey{
			ChannelID:             ch.ChannelId,
			PortID:                ch.PortId,
			CounterpartyChannelID: ch.Counterparty.ChannelId,
			CounterpartyPortID:    ch.Counterparty.PortId,
		}
		ccp.channelStateCache.SetOpen(k, ch.State == chantypes.OPEN, ch.Ordering)
	}
	return nil
}

func (ccp *CardanoChainProcessor) queryCycle(ctx context.Context, persistence *queryCyclePersistence) error {
	var err error
	persistence.latestHeight, err = ccp.latestHeightWithRetry(ctx)
	if err != nil {
		ccp.log.Error(
			"Failed to query latest height after max attempts",
			zap.Uint("attempts", latestHeightQueryRetries),
			zap.Error(err),
		)
		return nil
	}
	ccp.log.Debug("Queried latest height",
		zap.Int64("latest_height", persistence.latestHeight),
	)
	firstTimeInSync := false
	if !ccp.inSync {
		if (persistence.latestHeight - persistence.latestQueriedBlock) < inSyncNumBlocksThreshold {
			ccp.inSync = true
			firstTimeInSync = true
			ccp.log.Info("Chain is in sync")
		} else {
			ccp.log.Info("Chain is not yet in sync",
				zap.Int64("latest_queried_block", persistence.latestQueriedBlock),
				zap.Int64("latest_height", persistence.latestHeight),
			)
		}
	}
	ibcMessagesCache := processor.NewIBCMessagesCache()

	ibcHeaderCache := make(processor.IBCHeaderCache)

	ppChanged := false

	var latestHeader provider.IBCHeader
	newLatestQueriedBlock := persistence.latestQueriedBlock

	chainID := ccp.chainProvider.ChainId()

	pp := ccp.pathProcessors[0]
	src, dst := pp.PathEnd1, pp.PathEnd2

	if src.ChainProvider.Type() != "cardano" {
		src, dst = dst, src
	}
	dsth, err := dst.ChainProvider.QueryLatestHeight(ctx)
	if err != nil {
		return fmt.Errorf("error querying latest height for chain_id: %s, %w", dst.Info.ChainID, err)
	}
	var updateClientMessages []provider.RelayerMessage
	for i := persistence.latestQueriedBlock + 1; i <= persistence.latestHeight; i++ {
		var eg errgroup.Group
		var blockRes *ctypes.ResultBlockResults
		var ibcHeader provider.IBCHeader
		i := i
		eg.Go(func() (err error) {
			queryCtx, cancelQueryCtx := context.WithTimeout(ctx, blockResultsQueryTimeout)
			defer cancelQueryCtx()
			blockRes, err = ccp.chainProvider.QueryBlockResults(queryCtx, i)
			return err
		})
		eg.Go(func() (err error) {
			queryCtx, cancelQueryCtx := context.WithTimeout(ctx, queryTimeout)
			defer cancelQueryCtx()
			clientStateRes, err := dst.ChainProvider.QueryClientStateResponse(queryCtx, dsth, dst.Info.ClientID)
			if err != nil {
				return fmt.Errorf("failed to query the client state response: %w", err)
			}
			clientState, err := clienttypes.UnpackClientState(clientStateRes.ClientState)
			if err != nil {
				return fmt.Errorf("failed to unpack client state: %w", err)
			}
			ibcHeader, err = src.ChainProvider.QueryIBCMithrilHeader(queryCtx, i, &clientState)
			return err
		})
		if err := eg.Wait(); err != nil {
			if strings.Contains(err.Error(), "SkipImmutableFile: Missing mithril height") {
				ccp.log.Info("Skipping block", zap.Int64("height", i))
				continue
			}
			ccp.log.Warn("Error querying block data", zap.Error(err))
			break
		}

		latestHeader = ibcHeader.(*mithril.MithrilHeader)

		heightUint64 := uint64(i)
		ccp.latestBlock = provider.LatestBlock{
			Height: heightUint64,
			Time:   time.Unix(0, int64(latestHeader.ConsensusState().GetTimestamp())),
		}
		ibcHeaderCache[heightUint64] = latestHeader

		ppChanged = true

		hasIBCEvents := false

		for _, tx := range blockRes.TxsResults {
			if tx.Code != 0 {
				// tx was not successful
				continue
			}
			messages := ibcMessagesFromEvents(ccp.log, tx.Events, chainID, heightUint64, false)

			for _, m := range messages {
				ccp.handleMessage(ctx, m, ibcMessagesCache)
			}

			if len(messages) > 0 {
				hasIBCEvents = true
			}
		}
		if i < persistence.latestHeight {
			continue
		}
		if hasIBCEvents {
			dsth, err := dst.ChainProvider.QueryLatestHeight(ctx)
			if err != nil {
				return fmt.Errorf("error querying latest height for chain_id: %s, %w", dst.Info.ChainID, err)
			}
			clientStateRes, err := dst.ChainProvider.QueryClientStateResponse(ctx, dsth, dst.Info.ClientID)
			if err != nil {
				return fmt.Errorf("failed to query the client state response: %w", err)
			}
			clientState, err := clienttypes.UnpackClientState(clientStateRes.ClientState)
			if err != nil {
				return fmt.Errorf("failed to unpack client state: %w", err)
			}
			ibcHeader, err = src.ChainProvider.QueryIBCMithrilHeader(ctx, i, &clientState)
			data, ok := ibcHeader.(*mithril.MithrilHeader)
			if !ok {
				return fmt.Errorf("failed to cast IBC header to MithrilHeader")
			}
			msgUpdateClient, err := dst.ChainProvider.MsgUpdateClient(dst.Info.ClientID, data)
			if err != nil {
				return fmt.Errorf("error constructing MsgUpdateClient at height: %d for chain_id: %s, %w",
					i, src.Info.ChainID, err)
			}
			updateClientMessages = append(updateClientMessages, msgUpdateClient)
		}

		newLatestQueriedBlock = i
	}
	if len(updateClientMessages) > 0 {
		dst := ccp.pathProcessors[0].PathEnd2
		ctx, cancel := context.WithTimeout(context.Background(), time.Second*60)
		defer cancel()
		dst.ChainProvider.SendMessages(ctx, updateClientMessages, "")
	}

	if newLatestQueriedBlock == persistence.latestQueriedBlock {
		return nil
	}
	if !ppChanged {
		if firstTimeInSync {
			for _, pp := range ccp.pathProcessors {
				pp.ProcessBacklogIfReady()
			}
		}

		return nil
	}
	for _, pp := range ccp.pathProcessors {
		clientID := pp.RelevantClientID(chainID)
		clientState, err := ccp.clientState(ctx, clientID)
		if err != nil {
			ccp.log.Error("Error fetching client state",
				zap.String("client_id", clientID),
				zap.Error(err),
			)
			continue
		}

		if !strings.HasPrefix(clientID, "ibc_client-") {
			clientID = "ibc_client-" + clientID
		}

		pp.HandleNewData(chainID, processor.ChainProcessorCacheData{
			LatestBlock:          ccp.latestBlock,
			LatestHeader:         latestHeader,
			IBCMessagesCache:     ibcMessagesCache.Clone(),
			InSync:               ccp.inSync,
			ClientState:          clientState,
			ConnectionStateCache: ccp.connectionStateCache.FilterForClient(clientID),
			ChannelStateCache:    ccp.channelStateCache.FilterForClient(clientID, ccp.channelConnections, ccp.connectionClients),
			IBCHeaderCache:       ibcHeaderCache.Clone(),
		})
	}
	persistence.latestQueriedBlock = newLatestQueriedBlock

	return nil
}

func (ccp *CardanoChainProcessor) clientState(ctx context.Context, clientID string) (provider.ClientState, error) {
	if state, ok := ccp.latestClientState[clientID]; ok && state.TrustingPeriod > 0 {
		return state, nil
	}
	cs, err := ccp.chainProvider.QueryClientState(ctx, int64(ccp.latestBlock.Height), clientID)
	if err != nil {
		return provider.ClientState{}, err
	}
	tmCs, ok := cs.(*tmclient.ClientState)
	if !ok {
		return provider.ClientState{},
			fmt.Errorf("error when casting exported clientstate to tendermint type, got(%T)", cs)
	}
	clientState := provider.ClientState{
		ClientID:        clientID,
		ConsensusHeight: cs.GetLatestHeight().(clienttypes.Height),
		TrustingPeriod:  tmCs.TrustingPeriod,
	}
	ccp.latestClientState[clientID] = clientState
	return clientState, nil
}
