import { Grid } from '@mui/material';
import { ArrowStatusIconGrid } from '@src/components/DoubleArrowIcon';
import AddressInfoCard from '@src/containers/TransactionDetail/AddressInfo';
import Relayer from '@src/containers/TransactionDetail/Relayer';
import { txStatusFromCode } from '@src/utils/helper';
import {
  CARDANO_DEFAULT_TRANSFER_PORT,
  DEFAULT_TRANSFER_PORT,
} from '@src/constants';
import PacketTransfer from './PacketTransfer';

const DefaultPacketDisplay = ({
  packetId,
  packetsData,
  packetDataMgs,
}: {
  packetId: string;
  packetsData: { [key: string]: any };
  packetDataMgs: { [key: string]: any };
}) => {
  const currentPacketData = packetsData?.[packetId];
  if (!currentPacketData) return <></>;
  const packetMsgs = packetDataMgs?.[packetId];
  const relayerChain1Address = packetMsgs?.AcknowledgePacket?.sender || '';
  const relayerChain2Address = packetMsgs?.RecvPacket?.sender || '';
  const sender = packetMsgs?.SendPacket?.sender;
  const receiveMsgStatus = txStatusFromCode(packetMsgs?.RecvPacket?.code);
  const ackMsgStatus = txStatusFromCode(packetMsgs?.AcknowledgePacket?.code);
  return (
    <Grid
      container
      display="flex"
      justifyContent="space-between"
      gap="10px"
      paddingBottom="25px"
    >
      <Grid item xs={12} md={3.7}>
        <AddressInfoCard
          port={currentPacketData?.srcPort}
          chainId={currentPacketData?.srcChain}
          address={sender}
          channel={currentPacketData?.srcChannel}
          fromOrTo="From"
        />
      </Grid>
      <ArrowStatusIconGrid status={receiveMsgStatus} />
      <Grid item xs={12} md={3}>
        <Relayer
          packetSequence={currentPacketData?.sequence}
          chainId1={currentPacketData?.srcChain}
          chainId2={currentPacketData?.dstChain}
          address1={relayerChain1Address}
          address2={relayerChain2Address}
        />
      </Grid>
      <ArrowStatusIconGrid status={ackMsgStatus} />
      <Grid item xs={12} md={3.7}>
        <AddressInfoCard
          fromOrTo="To"
          port={currentPacketData?.dstPort}
          chainId={currentPacketData?.dstChain}
          address=""
          channel={currentPacketData?.dstChannel}
        />
      </Grid>
    </Grid>
  );
};

const PacketDisplay = ({
  packetId,
  packetList,
  packetsData,
  packetDataMgs,
}: {
  packetId: string;
  packetList: string[];
  packetsData: { [key: string]: any };
  packetDataMgs: { [key: string]: any };
}) => {
  const currentPacketData = packetsData?.[packetId];
  if (!currentPacketData) return <></>;
  const srcPort = currentPacketData?.srcPort;

  switch (srcPort) {
    case DEFAULT_TRANSFER_PORT:
    case CARDANO_DEFAULT_TRANSFER_PORT:
      return (
        <PacketTransfer
          packetId={packetId}
          packetList={packetList}
          packetsData={packetsData}
          packetDataMgs={packetDataMgs}
        />
      );
    default:
      return (
        <DefaultPacketDisplay
          packetId={packetId}
          packetsData={packetsData}
          packetDataMgs={packetDataMgs}
        />
      );
  }
};
export default PacketDisplay;
