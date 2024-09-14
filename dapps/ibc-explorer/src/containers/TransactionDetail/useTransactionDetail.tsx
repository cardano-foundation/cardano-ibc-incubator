/* eslint-disable no-await-in-loop */

import { useState, useEffect, useCallback } from 'react';
import { TX_STATUS } from '@src/constants';

import apolloClient from '@src/apis/apollo';
import {
  GET_MESSAGES_BY_TX_HASH,
  GET_PACKET_BY_PACKET_ID,
  GET_PACKET_BY_PARENT_PACKET_ID_SINGLE,
} from '@src/apis/query';

const getPacketsUp = async (packetId: string): Promise<any[]> => {
  const packets = await apolloClient
    .query({
      query: GET_PACKET_BY_PACKET_ID,
      variables: { packetId },
      fetchPolicy: 'network-only',
    })
    .then((res) => res.data.packets.nodes)
    .catch(() => []);
  if (packets.length === 0) return [];
  const result = [];
  let tmpPacket = packets[0];
  while (tmpPacket) {
    const { parentPacket, ...packet } = tmpPacket;
    result.push(packet);
    tmpPacket = parentPacket;
  }
  return result.reverse();
};

const getPacketsDown = async (packetId: string): Promise<any[]> => {
  let canGoDeeper = true;
  const result = [];
  let nextPacketId = packetId;
  do {
    const packets = await apolloClient
      .query({
        query: GET_PACKET_BY_PARENT_PACKET_ID_SINGLE,
        variables: { packetId: nextPacketId },
        fetchPolicy: 'network-only',
      })
      .then((res) => res.data.packets.nodes)
      .catch(() => []);
    if (packets.length === 0) {
      canGoDeeper = false;
    } else {
      result.push(packets[0]);
      nextPacketId = packets[0].id;
    }
  } while (canGoDeeper);
  return result;
};

export const useTransactionDetail = ({ txHash }: { txHash: string }) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [canLoadTx, setCanLoadTx] = useState<boolean>(true);
  const [packetList, setPacketList] = useState<string[]>([]);
  const [packetsData, setPacketsData] = useState<{ [key: string]: any }>({});
  const [packetDataMgs, setPacketDataMgs] = useState<{ [key: string]: any }>(
    {},
  );

  const tryLoadDataFromTx = async () => {
    setLoading(true);
    const msgs = await apolloClient
      .query({
        query: GET_MESSAGES_BY_TX_HASH,
        variables: { txHash },
        fetchPolicy: 'network-only',
      })
      .then((res) => res.data.messages.nodes)
      .catch(() => []);
    if (msgs.length === 0) {
      setCanLoadTx(false);
    } else {
      const msg = msgs[0];
      const anchorPacketId = msg.packet.id;

      const packetsUp = await getPacketsUp(anchorPacketId);
      const packetsDownAnchor =
        packetsUp.length > 0
          ? packetsUp[packetsUp.length - 1].id
          : anchorPacketId;

      const packetsDown = await getPacketsDown(packetsDownAnchor);
      const allPackets = [...packetsUp, ...packetsDown];
      setPacketList(allPackets.map((packet) => packet.id));
      const allPacketsData = (allPackets || []).reduce((acc, cur) => {
        acc[cur.id] = cur;
        return acc;
      }, {});
      setPacketsData(allPacketsData);
    }
    setLoading(false);
  };
  useEffect(() => {
    tryLoadDataFromTx();
  }, []);

  const updatePacketDataMsg = (packetId: string, data: any) => {
    setPacketDataMgs((prev) => ({ ...prev, [packetId]: data }));
  };

  const calculateOverallPacketStatus = useCallback(() => {
    let status = TX_STATUS.PROCESSING;
    if (loading) return status;
    packetList.forEach((packetId) => {
      const thisMsg = packetDataMgs[packetId];
      if (
        (thisMsg?.SendPacket && thisMsg?.SendPacket?.code !== '0') ||
        (thisMsg?.RecvPacket && thisMsg?.RecvPacket?.code !== '0') ||
        (thisMsg?.AcknowledgePacket && thisMsg?.AcknowledgePacket?.code !== '0')
      )
        status = TX_STATUS.FAILED;
    });
    if (status !== TX_STATUS.FAILED) {
      const firstPacketData = packetsData[packetList[0]]?.data;
      let numPkgNeeded = 1;
      numPkgNeeded += (firstPacketData.match(/forward/g) || []).length;
      numPkgNeeded += (firstPacketData.match(/osmosis_swap/g) || []).length;
      if (packetList.length !== numPkgNeeded) return status;

      const lastMsg = packetDataMgs[packetList[packetList.length - 1]];
      if (
        lastMsg?.AcknowledgePacket &&
        lastMsg?.AcknowledgePacket?.code === '0'
      ) {
        status = TX_STATUS.SUCCESS;
      }
    }
    return status;
  }, [JSON.stringify(packetDataMgs)]);

  return {
    loading,
    canLoadTx,
    packetList,
    packetsData,
    packetDataMgs,
    updatePacketDataMsg,
    calculateOverallPacketStatus,
  };
};
