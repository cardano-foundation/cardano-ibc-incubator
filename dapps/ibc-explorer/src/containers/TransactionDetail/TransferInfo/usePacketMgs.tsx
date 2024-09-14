/* eslint-disable no-await-in-loop */

import { useState, useEffect } from 'react';
import apolloClient from '@src/apis/apollo';
import { GET_MESSAGES_BY_PACKET_ID } from '@src/apis/query';

export const usePacketMgs = ({
  packetId,
  updatePacketDataMsg,
}: {
  packetId: string;
  updatePacketDataMsg: (pId: string, data: any) => void;
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [msgs, setMsgs] = useState<{ [key: string]: any }>({});

  const tryLoadDataFromPacketId = async () => {
    setLoading(true);
    const msgsData = await apolloClient
      .query({
        query: GET_MESSAGES_BY_PACKET_ID,
        variables: { packetId },
        fetchPolicy: 'network-only',
      })
      .then((res) => res.data.messages.nodes)
      .catch(() => []);
    if (msgsData.length !== 0) {
      const tmpData = (msgsData || []).reduce((acc: any, cur: any) => {
        acc[cur.msgType] = cur;
        return acc;
      }, {});
      updatePacketDataMsg(packetId, tmpData);
      setMsgs(tmpData);
    }
    setLoading(false);
  };
  useEffect(() => {
    tryLoadDataFromPacketId();
  }, []);

  return { loading, msgs };
};
