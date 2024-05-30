package relayer

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/cardano/relayer/v1/relayer/chains/cosmos/mithril"

	"github.com/cardano/relayer/v1/constant"

	"github.com/avast/retry-go/v4"
	"github.com/cardano/relayer/v1/relayer/provider"
	codectypes "github.com/cosmos/cosmos-sdk/codec/types"
	clienttypes "github.com/cosmos/ibc-go/v7/modules/core/02-client/types"
	ibcexported "github.com/cosmos/ibc-go/v7/modules/core/exported"
	tmclient "github.com/cosmos/ibc-go/v7/modules/light-clients/07-tendermint"
	"go.uber.org/zap"
	"golang.org/x/sync/errgroup"
)

// CreateClients creates clients for src on dst and dst on src if the client ids are unspecified.
func (c *Chain) CreateClients(ctx context.Context, dst *Chain, allowUpdateAfterExpiry, allowUpdateAfterMisbehaviour, override bool, customClientTrustingPeriod time.Duration, memo string) (string, string, error) {
	// Query the latest heights on src and dst and retry if the query fails
	c.log.Info("Start CreateClients", zap.Time("time", time.Now()))
	var srch, dsth int64
	cardanoChain, cosmosChain := c, dst
	if cardanoChain.ChainProvider.Type() != "cardano" {
		cardanoChain = dst
		cosmosChain = c
	}
	if err := retry.Do(func() error {
		var err error
		//srch, err = c.ChainProvider.QueryCardanoLatestHeight(ctx)
		//dsth, err = QueryCosmosLatestHeight(ctx, dst)
		srch, err = cardanoChain.ChainProvider.QueryLatestHeight(ctx)
		dsth, err = cosmosChain.ChainProvider.QueryLatestHeight(ctx)
		if srch == 0 || dsth == 0 || err != nil {
			return fmt.Errorf("failed to query latest heights: %w", err)
		}

		return nil
	}, retry.Context(ctx), RtyAtt, RtyDel, RtyErr); err != nil {
		return "", "", err
	}
	// Query the light signed headers for src & dst at the heights srch & dsth, retry if the query fails
	var dstUpdateHeader provider.IBCHeader
	if err := retry.Do(func() error {
		var err error
		cosmosChain.Chainid = cosmosChain.PathEnd.ChainID
		dstUpdateHeader, err = QueryIBCHeader(ctx, cosmosChain, dsth)
		if err != nil {
			return err
		}
		return nil
	}, retry.Context(ctx), RtyAtt, RtyDel, RtyErr, retry.OnRetry(func(n uint, err error) {
		c.log.Info(
			"Failed to get light signed headers",
			zap.String("src_chain_id", c.ChainID()),
			zap.Int64("src_height", srch),
			zap.String("dst_chain_id", dst.ChainID()),
			zap.Int64("dst_height", dsth),
			zap.Uint("attempt", n+1),
			zap.Uint("max_attempts", RtyAttNum),
			zap.Error(err),
		)
	})); err != nil {
		return "", "", err
	}

	var clientSrc, clientDst string
	eg, egCtx := errgroup.WithContext(ctx)
	eg.Go(func() error {
		var err error
		// Create client on cardano for cosmos
		clientSrc, err = CreateClient(egCtx, cardanoChain, cosmosChain, dstUpdateHeader, allowUpdateAfterExpiry, allowUpdateAfterMisbehaviour, override, customClientTrustingPeriod, memo, true)
		if err != nil {
			return fmt.Errorf("failed to create client on src chain{%s}: %w", c.ChainID(), err)
		}
		return nil
	})

	eg.Go(func() error {
		var err error
		// Create client on cosmos for cardano
		clientDst, err = CreateClient(egCtx, cardanoChain, cosmosChain, dstUpdateHeader, allowUpdateAfterExpiry, allowUpdateAfterMisbehaviour, override, customClientTrustingPeriod, memo, false)
		if err != nil {
			return fmt.Errorf("failed to create client on dst chain{%s}: %w", dst.ChainID(), err)
		}
		return nil
	})
	if err := eg.Wait(); err != nil {
		// If one completed successfully and the other didn't, we can still report modified.
		return clientSrc, clientDst, err
	}
	doneTime := time.Now()
	c.log.Info(
		"Clients created",
		zap.String("src_client_id", c.PathEnd.ClientID),
		zap.String("src_chain_id", c.ChainID()),
		zap.String("dst_client_id", dst.PathEnd.ClientID),
		zap.String("dst_chain_id", dst.ChainID()),
		zap.Time("time", doneTime),
	)
	c.log.Info("Finish CreateClients", zap.Time("time", doneTime))
	return clientSrc, clientDst, nil
}

// CreateClient creates client tracking dst on src.
func CreateClient(
	ctx context.Context,
	cardanoChain, cosmosChain *Chain,
	dstUpdateHeader provider.IBCHeader,
	allowUpdateAfterExpiry bool,
	allowUpdateAfterMisbehaviour bool,
	override bool,
	customClientTrustingPeriod time.Duration,
	memo string, createType bool) (string, error) {
	//If a client ID was specified in the path and override is not set, ensure the client exists.
	if !override && cardanoChain.PathEnd.ClientID != "" {
		// TODO: check client is not expired
		srcHeight, err := cardanoChain.ChainProvider.QueryLatestHeight(ctx)
		if err != nil {
			return "", err
		}
		_, err = cardanoChain.ChainProvider.QueryClientStateResponse(ctx, int64(srcHeight), cardanoChain.ClientID())
		if err != nil {
			return "", fmt.Errorf("please ensure provided on-chain client (%s) exists on the chain (%s): %w",
				cardanoChain.PathEnd.ClientID, cardanoChain.ChainID(), err)
		}

		return "", nil
	}

	var clientID string
	switch createType {
	case false: //Create client on cosmos for cardano
		cosmosChain.log.Info("Start create client on cosmos for cardano", zap.Time("time", time.Now()))

		srcHeight, err := cardanoChain.ChainProvider.QueryLatestHeight(ctx)
		if err != nil {
			return "", err
		}
		mainClientState, mainConsensusState, err := cardanoChain.ChainProvider.QueryCardanoState(ctx, srcHeight)
		if err != nil {
			return "", err
		}
		if customClientTrustingPeriod != 0 {
			mainClientState.(*mithril.ClientState).TrustingPeriod = customClientTrustingPeriod
		} else {
			mainClientState.(*mithril.ClientState).TrustingPeriod = constant.ClientTrustingPeriod
		}

		createMsg, err := cosmosChain.ChainProvider.MsgCreateClient(mainClientState, mainConsensusState)
		if err != nil {
			return "", fmt.Errorf("failed to compose CreateClient msg for chain{%s} tracking the state of chain{%s}: %w",
				cardanoChain.ChainID(), cosmosChain.ChainID(), err)
		}
		msgs := []provider.RelayerMessage{createMsg}
		// if a matching client does not exist, create one
		var res *provider.RelayerTxResponse
		if err := retry.Do(func() error {
			var success bool
			var err error
			res, success, err = cosmosChain.ChainProvider.SendMessages(ctx, msgs, memo)
			if err != nil {
				cosmosChain.LogFailedTx(res, err, msgs)
				return fmt.Errorf("failed to send messages on chain{%s}: %w", cosmosChain.ChainID(), err)
			}
			if !success {
				cosmosChain.LogFailedTx(res, nil, msgs)
				return fmt.Errorf("tx failed on chain{%s}: %s", cosmosChain.ChainID(), res.Data)
			}
			return nil
		}, retry.Context(ctx), RtyAtt, RtyDel, RtyErr); err != nil {
			return "", err
		}
		// update the client identifier
		// use index 0, the transaction only has one message
		if clientID, err = parseClientIDFromEvents(res.Events); err != nil {
			return "", err
		}
		cosmosChain.PathEnd.ClientID = clientID
		return clientID, nil
	case true: //Create client on cardano for cosmos
		cardanoChain.log.Info("Start create client on cardano for cosmos", zap.Time("time", time.Now()))
		tp := customClientTrustingPeriod
		if tp == 0 {
			if err := retry.Do(func() error {
				var err error
				tp, err = cosmosChain.GetTrustingPeriod(ctx)
				if err != nil {
					return fmt.Errorf("failed to get trusting period for chain{%s}: %w", cosmosChain.ChainID(), err)
				}
				if tp == 0 {
					return retry.Unrecoverable(fmt.Errorf("chain %s reported invalid zero trusting period", cosmosChain.ChainID()))
				}
				return nil
			}, retry.Context(ctx), RtyAtt, RtyDel, RtyErr); err != nil {
				return "", err
			}
		}
		//Query the unbonding period for dst and retry if the query fails
		var ubdPeriod time.Duration
		if err := retry.Do(func() error {
			var err error
			ubdPeriod, err = cosmosChain.ChainProvider.QueryUnbondingPeriod(ctx)
			if err != nil {
				return fmt.Errorf("failed to query unbonding period for chain{%s}: %w", cosmosChain.ChainID(), err)
			}
			return nil
		}, retry.Context(ctx), RtyAtt, RtyDel, RtyErr); err != nil {
			return "", err
		}
		clientState, err := cosmosChain.ChainProvider.NewClientState(cosmosChain.ChainID(), dstUpdateHeader, tp, ubdPeriod, allowUpdateAfterExpiry, allowUpdateAfterMisbehaviour)
		if err != nil {
			return "", fmt.Errorf("failed to create new client state for chain{%s}: %w", cosmosChain.ChainID(), err)
		}
		createMsg, err := cardanoChain.ChainProvider.MsgCreateClient(clientState, dstUpdateHeader.ConsensusState())
		if err != nil {
			return "", fmt.Errorf("failed to compose CreateClient msg for chain{%s} tracking the state of chain{%s}: %w",
				cardanoChain.ChainID(), cosmosChain.ChainID(), err)
		}
		msgs := []provider.RelayerMessage{createMsg}
		var res *provider.RelayerTxResponse
		if err := retry.Do(func() error {
			var success bool
			var err error
			res, success, err = cardanoChain.ChainProvider.SendMessages(ctx, msgs, memo)
			if err != nil {
				cardanoChain.LogFailedTx(res, err, msgs)
				return fmt.Errorf("failed to send messages on chain{%s}: %w", cardanoChain.ChainID(), err)
			}
			if !success {
				cardanoChain.LogFailedTx(res, nil, msgs)
				return fmt.Errorf("tx failed on chain{%s}: %s", cardanoChain.ChainID(), res.Data)
			}
			return nil
		}, retry.Context(ctx), RtyAtt, RtyDel, RtyErr); err != nil {
			return "", err
		}
		if clientID, err = parseClientIDFromEvents(res.Events); err != nil {
			return "", err
		}
		cardanoChain.PathEnd.ClientID = clientID
		return clientID, nil
	}

	return clientID, nil
}

// MsgUpdateClient queries for the current client state on dst,
// then queries for the latest and trusted headers on src
// in order to build a MsgUpdateClient message for dst.
func MsgUpdateClient(
	ctx context.Context,
	src, dst *Chain,
	srch, dsth int64,
) (provider.RelayerMessage, error) {
	var dstClientState ibcexported.ClientState
	// srcClientId := src.ClientID()
	dstClientId := dst.ClientID()
	// srcClientId = strings.TrimPrefix(srcClientId, "07-tendermint-")
	dstClientId = strings.TrimPrefix(dstClientId, "07-tendermint-")

	if err := retry.Do(func() error {
		var err error
		dstClientState, err = dst.ChainProvider.QueryClientState(ctx, dsth, dstClientId)
		return err
	}, retry.Context(ctx), RtyAtt, RtyDel, RtyErr, retry.OnRetry(func(n uint, err error) {
		dst.log.Info(
			"Failed to query client state when updating clients",
			zap.String("client_id", dstClientId),
			zap.Uint("attempt", n+1),
			zap.Uint("max_attempts", RtyAttNum),
			zap.Error(err),
		)
	})); err != nil {
		return nil, err
	}
	switch src.ChainProvider.Type() {
	case "cardano": // cardano -> cosmos
		var ibcHeader provider.IBCHeader
		eg, egCtx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return retry.Do(func() error {
				var err error
				clientStateRes, err := dst.ChainProvider.QueryClientStateResponse(ctx, dsth, dst.ClientID())
				if err != nil {
					return fmt.Errorf("failed to query the client state response: %w", err)
				}
				clientState, err := clienttypes.UnpackClientState(clientStateRes.ClientState)
				if err != nil {
					return fmt.Errorf("failed to unpack client state: %w", err)
				}
				ibcHeader, err = src.ChainProvider.QueryIBCMithrilHeader(egCtx, srch, &clientState)
				return err
			}, retry.Context(egCtx), RtyAtt, RtyDel, RtyErr, retry.OnRetry(func(n uint, err error) {
				src.log.Info(
					"Failed to query Mithril header from Cardano when building update client message",
					zap.String("client_id", dstClientId),
					zap.Uint("attempt", n+1),
					zap.Uint("max_attempts", RtyAttNum),
					zap.Error(err),
				)
			}))
		})

		if err := eg.Wait(); err != nil {
			return nil, err
		}

		msgUpdateClient, ok := ibcHeader.(*mithril.MithrilHeader)
		if !ok {
			return nil, fmt.Errorf("failed to cast IBC header to MithrilHeader")
		}

		// get cardano client consensus state
		clientConsensusState, err := dst.ChainProvider.QueryClientConsensusState(ctx, dsth, dstClientId, dstClientState.GetLatestHeight())
		if err != nil {
			return nil, err
		}
		consensusStateData, err := clienttypes.UnpackClientMessage(clientConsensusState.ConsensusState)
		if err != nil {
			return nil, err
		}
		consensusState, ok := consensusStateData.(*mithril.ConsensusState)
		if !ok {
			return nil, fmt.Errorf("failed to cast consensus state to MithrilHeader")
		}
		if msgUpdateClient.TransactionSnapshotCertificate.Hash == consensusState.LatestCertHashTxSnapshot {
			return nil, nil
		}
		// updates off-chain light client
		return dst.ChainProvider.MsgUpdateClient(dstClientId, msgUpdateClient)

	case "cosmos": // cosmos -> cardano
		var srcHeader, dstTrustedHeader provider.IBCHeader

		eg, egCtx := errgroup.WithContext(ctx)
		eg.Go(func() error {
			return retry.Do(func() error {
				var err error
				srcHeader, err = src.ChainProvider.QueryIBCHeader(egCtx, srch)
				return err
			}, retry.Context(egCtx), RtyAtt, RtyDel, RtyErr, retry.OnRetry(func(n uint, err error) {
				src.log.Info(
					"Failed to query IBC header when building update client message",
					zap.String("client_id", dstClientId),
					zap.Uint("attempt", n+1),
					zap.Uint("max_attempts", RtyAttNum),
					zap.Error(err),
				)
			}))
		})
		eg.Go(func() error {
			return retry.Do(func() error {
				var err error
				dstTrustedHeader, err = src.ChainProvider.QueryIBCHeader(egCtx, int64(dstClientState.GetLatestHeight().GetRevisionHeight())+1)
				return err
			}, retry.Context(egCtx), RtyAtt, RtyDel, RtyErr, retry.OnRetry(func(n uint, err error) {
				src.log.Info(
					"Failed to query IBC header when building update client message",
					zap.String("client_id", dstClientId),
					zap.Uint("attempt", n+1),
					zap.Uint("max_attempts", RtyAttNum),
					zap.Error(err),
				)
			}))
		})

		if err := eg.Wait(); err != nil {
			return nil, err
		}

		var updateHeader ibcexported.ClientMessage
		if err := retry.Do(func() error {
			var err error
			updateHeader, err = src.ChainProvider.MsgUpdateClientHeader(srcHeader, dstClientState.GetLatestHeight().(clienttypes.Height), dstTrustedHeader)
			return err
		}, retry.Context(ctx), RtyAtt, RtyDel, RtyErr, retry.OnRetry(func(n uint, err error) {
			src.log.Info(
				"Failed to build update client header",
				zap.String("client_id", dstClientId),
				zap.Uint("attempt", n+1),
				zap.Uint("max_attempts", RtyAttNum),
				zap.Error(err),
			)
		})); err != nil {
			return nil, err
		}

		// updates off-chain light client
		return dst.ChainProvider.MsgUpdateClient(dstClientId, updateHeader)
	}

	return nil, nil
}

// UpdateClients updates clients for src on dst and dst on src given the configured paths.
func UpdateClients(
	ctx context.Context,
	src, dst *Chain,
	memo string,
) error {
	srch, dsth, err := QueryLatestHeights(ctx, src, dst)
	if err != nil {
		return err
	}
	var srcMsgUpdateClient, dstMsgUpdateClient provider.RelayerMessage
	eg, egCtx := errgroup.WithContext(ctx)
	eg.Go(func() error {
		var err error
		srcMsgUpdateClient, err = MsgUpdateClient(egCtx, dst, src, dsth, srch)
		return err
	})
	eg.Go(func() error {
		var err error
		dstMsgUpdateClient, err = MsgUpdateClient(egCtx, src, dst, srch, dsth)
		return err
	})
	if err = eg.Wait(); err != nil {
		return err
	}

	clients := &RelayMsgs{
		Src: []provider.RelayerMessage{srcMsgUpdateClient},
		Dst: []provider.RelayerMessage{dstMsgUpdateClient},
	}
	if srcMsgUpdateClient == nil {
		clients.Src = []provider.RelayerMessage{}
	}
	if dstMsgUpdateClient == nil {
		clients.Dst = []provider.RelayerMessage{}
	}
	//clients.Src = nil
	// Send msgs to both chains
	result := clients.Send(ctx, src.log, AsRelayMsgSender(src), AsRelayMsgSender(dst), memo)
	if err := result.Error(); err != nil {
		if result.PartiallySent() {
			src.log.Info(
				"Partial success when updating clients",
				zap.String("src_chain_id", src.ChainID()),
				zap.String("dst_chain_id", dst.ChainID()),
				zap.Object("send_result", result),
			)
		}
		return err
	}

	src.log.Info(
		"Clients updated",
		zap.String("src_chain_id", src.ChainID()),
		zap.String("src_client", src.PathEnd.ClientID),

		zap.String("dst_chain_id", dst.ChainID()),
		zap.String("dst_client", dst.PathEnd.ClientID),
	)

	return nil
}

// UpgradeClient upgrades the client on dst after src chain has undergone an upgrade.
// If height is zero, will use the latest height of the source chain.
// If height is non-zero, it will be used for queries on the source chain.
func UpgradeClient(
	ctx context.Context,
	src, dst *Chain,
	height int64,
	memo string,
) error {
	srch, dsth, err := QueryLatestHeights(ctx, src, dst)
	if err != nil {
		return err
	}

	if height != 0 {
		srch = height
	}

	var eg errgroup.Group

	var clientRes *clienttypes.QueryClientStateResponse
	eg.Go(func() error {
		var err error
		clientRes, err = src.ChainProvider.QueryUpgradedClient(ctx, srch)
		return err
	})

	var consRes *clienttypes.QueryConsensusStateResponse
	eg.Go(func() error {
		var err error
		consRes, err = src.ChainProvider.QueryUpgradedConsState(ctx, srch)
		return err
	})

	var updateMsg provider.RelayerMessage
	eg.Go(func() error {
		var err error
		updateMsg, err = MsgUpdateClient(ctx, src, dst, srch, dsth)
		return err
	})

	if err := eg.Wait(); err != nil {
		return err
	}

	upgradeMsg, err := dst.ChainProvider.MsgUpgradeClient(dst.ClientID(), consRes, clientRes)
	if err != nil {
		return err
	}

	msgs := []provider.RelayerMessage{
		updateMsg,
		upgradeMsg,
	}

	res, _, err := dst.ChainProvider.SendMessages(ctx, msgs, memo)
	if err != nil {
		dst.LogFailedTx(res, err, msgs)
		return err
	}

	return nil
}

// MustGetHeight takes the height inteface and returns the actual height
func MustGetHeight(h ibcexported.Height) clienttypes.Height {
	height, ok := h.(clienttypes.Height)
	if !ok {
		panic("height is not an instance of height!")
	}
	return height
}

// findMatchingClient is a helper function that will determine if there exists a client with identical client and
// consensus states to the client which would have been created. Source is the chain that would be adding a client
// which would track the counterparty. Therefore, we query source for the existing clients
// and check if any match the counterparty. The counterparty must have a matching consensus state
// to the latest consensus state of a potential match. The provided client state is the client
// state that will be created if there exist no matches.
func findMatchingClient(ctx context.Context, src, dst *Chain, newClientState ibcexported.ClientState) (string, error) {
	var (
		clientsResp clienttypes.IdentifiedClientStates
		err         error
	)

	if err = retry.Do(func() error {
		clientsResp, err = src.ChainProvider.QueryClients(ctx)
		if err != nil {
			return err
		}
		return nil
	}, retry.Context(ctx), RtyAtt, RtyDel, RtyErr, retry.OnRetry(func(n uint, err error) {
		src.log.Info(
			"Failed to query clients",
			zap.String("chain_id", src.ChainID()),
			zap.Uint("attempt", n+1),
			zap.Uint("max_attempts", RtyAttNum),
			zap.Error(err),
		)
	})); err != nil {
		return "", err
	}

	for _, existingClientState := range clientsResp {
		clientID, err := provider.ClientsMatch(ctx, src.ChainProvider, dst.ChainProvider, existingClientState, newClientState)

		// If there is an error parsing/type asserting the client state in ClientsMatch this is going
		// to make the entire find matching client logic fail.
		// We should really never be encountering an error here and if we do it is probably a sign of a
		// larger scale problem at hand.
		if err != nil {
			return "", err
		}
		if clientID != "" {
			return clientID, nil
		}
	}

	return "", nil
}

// parseClientIDFromEvents parses events emitted from a MsgCreateClient and returns the
// client identifier.
func parseClientIDFromEvents(events []provider.RelayerEvent) (string, error) {
	for _, event := range events {
		if event.EventType == clienttypes.EventTypeCreateClient {
			for attributeKey, attributeValue := range event.Attributes {
				if attributeKey == clienttypes.AttributeKeyClientID {
					return attributeValue, nil
				}
			}
		}
	}
	return "", fmt.Errorf("client identifier event attribute not found")
}

type ClientStateInfo struct {
	ChainID        string
	TrustingPeriod time.Duration
	LatestHeight   ibcexported.Height
}

func ClientInfoFromClientState(clientState *codectypes.Any) (ClientStateInfo, error) {
	clientStateExported, err := clienttypes.UnpackClientState(clientState)
	if err != nil {
		return ClientStateInfo{}, err
	}

	switch t := clientStateExported.(type) {
	case *tmclient.ClientState:
		return ClientStateInfo{
			ChainID:        t.ChainId,
			TrustingPeriod: t.TrustingPeriod,
			LatestHeight:   t.LatestHeight,
		}, nil
	default:
		return ClientStateInfo{}, fmt.Errorf("unhandled client state type: (%T)", clientState)
	}
}
