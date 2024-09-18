import { Grid } from '@mui/material';
import { ArrowStatusIconGrid } from '@src/components/DoubleArrowIcon';
import AddressInfoCard from '@src/containers/TransactionDetail/AddressInfo';
import Relayer from '@src/containers/TransactionDetail/Relayer';
import { txStatusFromCode } from '@src/utils/helper';

const PacketTransfer = ({
  packetId,
  // eslint-disable-next-line no-unused-vars
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
  const packetMsgs = packetDataMgs?.[packetId];
  // console.log(packetMsgs);
  const relayerChain1Address = packetMsgs?.AcknowledgePacket?.sender || '';
  const relayerChain2Address = packetMsgs?.RecvPacket?.sender || '';
  const sender = packetMsgs?.SendPacket?.sender;
  let receiver = '';
  const packetDataStr = currentPacketData?.data || '';
  try {
    const packetData = JSON.parse(packetDataStr);
    receiver = packetData?.receiver;
  } catch (_) {
    // eslint-disable-next-line no-console
    console.log('Cannot parse pkg data');
  }
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
          address={receiver}
          channel={currentPacketData?.dstChannel}
        />
      </Grid>
    </Grid>
  );
};

export default PacketTransfer;
