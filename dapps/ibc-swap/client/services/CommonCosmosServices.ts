/* eslint-disable no-await-in-loop */
/* eslint-disable camelcase */

import { sha256 } from 'js-sha256';
import { DenomTrace } from 'cosmjs-types/ibc/applications/transfer/v1/transfer';
import { State, stateFromJSON } from 'cosmjs-types/ibc/core/channel/v1/channel';

import {
  DEFAULT_PFM_FEE,
  queryAllChannelsUrl,
  queryAllDenomTracesUrl,
  queryChannelsPrefixUrl,
  queryPacketForwardParamsUrl,
} from '@/constants';
import {
  IBCDenomTrace,
  QueryChannelResponse,
  QueryClientStateResponse,
  RawChannelMapping,
} from '@/types/IBCParams';
import BigNumber from 'bignumber.js';
import { toast } from 'react-toastify';

export async function fetchAllDenomTraces(
  restUrl: string,
): Promise<IBCDenomTrace> {
  const fetchUrl = `${restUrl}${queryAllDenomTracesUrl}?pagination.limit=10000`;
  const tmpTrace: IBCDenomTrace = {};
  const firstFetch = await fetch(fetchUrl)
    .then((res) => res.json())
    .catch(() => {
      toast.error('Failed to fetch denom trace.', { theme: 'colored' });
    });
  const denomTraces = (firstFetch?.denom_traces || []) as any[];
  denomTraces.forEach((tracing) => {
    const { path, base_denom } = tracing;
    const ibcHash = `ibc/${sha256(`${path}/${base_denom}`).toUpperCase()}`;
    tmpTrace[`${ibcHash}`] = {
      path,
      baseDenom: base_denom,
    };
  });
  let nextKey = firstFetch?.pagination?.next_key;
  while (nextKey && typeof nextKey === 'string') {
    const nextFetchUrl = `${fetchUrl}&pagination.key=${nextKey}`;
    const nextFetch = await fetch(nextFetchUrl).then((res) => res.json());
    const denomTracesNext = (nextFetch?.denom_traces || []) as any[];
    denomTracesNext.forEach((tracing) => {
      const { path, base_denom } = tracing;
      const ibcHash = `ibc/${sha256(`${path}/${base_denom}`).toUpperCase()}`;
      tmpTrace[`${ibcHash}`] = {
        path,
        baseDenom: base_denom,
      };
    });
    nextKey = nextFetch?.pagination?.next_key;
  }
  return tmpTrace;
}

export async function fetchClientStateFromChannel(
  restUrl: string,
  channelId: string,
  portId: string,
): Promise<QueryClientStateResponse> {
  const queryUrl = `${restUrl}${queryChannelsPrefixUrl}/${channelId}/ports/${portId}/client_state`;
  const data = await fetch(queryUrl)
    .then((res) => res.json())
    .catch(() => {
      toast.error('Failed to fetch ports.', { theme: 'colored' });
    });
  return (data?.identified_client_state || {}) as QueryClientStateResponse;
}

const getMaxChannelId = (channel1: string, channel2: string) => {
  const [, id1] = channel1.split('-');
  const [, id2] = channel2.split('-');
  return `channel-${Math.max(parseInt(id1, 10), parseInt(id2, 10))}`;
};
type maxSrcChannelIdType = {
  [key: string]: {
    channel: string;
    index: number;
  };
};

// TODO: need backend to collect instead of client
export async function fetchAllChannels(
  chainId: string,
  restUrl: string,
): Promise<{
  bestChannel: RawChannelMapping[];
  channelsMap: any;
}> {
  const tmpData: RawChannelMapping[] = [];
  const maxSrcChannelId: maxSrcChannelIdType = {};
  const fetchUrl = `${restUrl}${queryAllChannelsUrl}`;
  const firstFetch = await fetch(fetchUrl)
    .then((res) => res.json())
    .catch(() => {
      toast.error('Failed to fetch channels.', { theme: 'colored' });
    });
  (firstFetch?.channels || []).forEach((channel: QueryChannelResponse) => {
    const { channel_id, port_id, state, counterparty } = channel;
    if (stateFromJSON(state) === State.STATE_OPEN) {
      tmpData.push({
        srcChain: chainId,
        srcChannel: channel_id,
        srcPort: port_id,
        destChannel: counterparty.channel_id,
        destPort: counterparty.port_id,
      });
    }
  });

  let nextKey = firstFetch?.pagination?.next_key;
  while (nextKey && typeof nextKey === 'string') {
    const nextFetchUrl = `${restUrl}${queryAllChannelsUrl}&pagination.key=${nextKey}`;
    const nextFetch = await fetch(nextFetchUrl)
      .then((res) => res.json())
      .catch(() => {
        toast.error('Failed to fetch channels.', { theme: 'colored' });
      });
    (nextFetch?.channels || []).forEach((channel: QueryChannelResponse) => {
      const { channel_id, port_id, state, counterparty } = channel;
      if (stateFromJSON(state) === State.STATE_OPEN) {
        tmpData.push({
          srcChain: chainId,
          srcChannel: channel_id,
          srcPort: port_id,
          destChannel: counterparty.channel_id,
          destPort: counterparty.port_id,
        });
      }
    });
    nextKey = nextFetch?.pagination?.next_key;
  }
  await Promise.all(
    tmpData.map((channelPair: RawChannelMapping, index: number) => {
      const { srcChannel, srcPort } = channelPair;
      return fetchClientStateFromChannel(restUrl, srcChannel, srcPort).then(
        (res: QueryClientStateResponse) => {
          const {
            client_state: { chain_id },
          } = res;
          tmpData[index].destChain = chain_id;
          // only keep largest channel of each pair
          if (!maxSrcChannelId[chain_id]) {
            maxSrcChannelId[chain_id] = {
              index,
              channel: tmpData[index].srcChannel,
            };
          } else {
            const lgChannel = getMaxChannelId(
              tmpData[index].srcChannel,
              maxSrcChannelId[chain_id].channel,
            );
            maxSrcChannelId[chain_id] = {
              index:
                lgChannel === tmpData[index].srcChannel
                  ? index
                  : maxSrcChannelId[chain_id].index,
              channel: lgChannel,
            };
          }
        },
      );
    }),
  );

  const bestChannel = Object.keys(maxSrcChannelId).map((item) => {
    const { index } = maxSrcChannelId[item];
    return tmpData[index];
  });
  let channelsMap: {
    [key: string]: { destChain: string; destChannel: string; destPort: string };
  } = {};
  tmpData.forEach((channelPair) => {
    const { srcChain, srcChannel, srcPort, destChannel, destPort, destChain } =
      channelPair;
    channelsMap[`${srcChain}_${srcPort}_${srcChannel}`] = {
      destChain: destChain || '',
      destChannel,
      destPort,
    };
    channelsMap[`${destChain}_${destPort}_${destChannel}`] = {
      destChain: srcChain,
      destChannel: srcChannel,
      destPort: srcPort,
    };
  });
  return { bestChannel, channelsMap };
}

export async function fetchPacketForwardFee(
  restUrl: string,
): Promise<BigNumber> {
  const fetchUrl = `${restUrl}${queryPacketForwardParamsUrl}`;
  const data = await fetch(fetchUrl)
    .then((res) => res.json())
    .catch(() => ({
      params: {
        fee_percentage: DEFAULT_PFM_FEE,
      },
    }));
  return BigNumber(data.params.fee_percentage);
}

export async function getTokenDenomTraceCosmos(
  restUrl: string,
  token: string,
): Promise<{
  denom_trace: {
    path: string;
    base_denom: string;
  };
}> {
  let queryTokenHash = token.replaceAll('ibc/', '');
  let tokenTraceReturn = {
    denom_trace: {
      path: '',
      base_denom: queryTokenHash,
    },
  };

  const fetchUrl = `${restUrl}${queryAllDenomTracesUrl}/${queryTokenHash}`;
  const data = await fetch(fetchUrl)
    .then((res) => res.json())
    .catch(() => tokenTraceReturn);
  return data;
}
