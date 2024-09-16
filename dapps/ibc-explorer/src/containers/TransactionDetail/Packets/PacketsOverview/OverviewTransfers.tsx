import { Box, Grid, Typography } from '@mui/material';
import TokenAvatar from '@src/containers/TransactionDetail/TokenAvatar';
import SendReceiveSection from '@src/containers/TransactionDetail/SendReceiveSection';
import {
  CARDANO_LOVELACE_HEX,
  findTokenImg,
} from '@src/configs/customChainInfo';

const OverviewTransfers = ({
  packetList,
  packetsData,
  packetDataMgs,
}: {
  packetList: string[];
  packetsData: { [key: string]: any };
  packetDataMgs: { [key: string]: any };
}) => {
  let isSwap = false;
  const firstPacket = packetList?.[0];
  const firstPacketData = packetsData?.[firstPacket] || {};
  const firstPacketDataInfo = JSON.parse(firstPacketData?.data || '{}');
  if (!firstPacketDataInfo?.denom) {
    return <></>;
  }
  const sendAmount = firstPacketDataInfo?.amount || '--';
  let sendToken = firstPacketDataInfo?.denom;
  const sendTokenPath = firstPacketDataInfo?.denom;
  if (sendToken.toLowerCase() === CARDANO_LOVELACE_HEX) {
    sendToken = 'lovelace';
  }
  const tokenImg = findTokenImg(firstPacketData?.srcChain, sendToken);
  const firstPacketMemoStr = firstPacketDataInfo?.memo || '{}';
  isSwap = (firstPacketMemoStr.match(/osmosis_swap/g) || []).length > 0;
  console.log(`isSwap:`, isSwap);
  console.log(`packetDataMgs:`, packetDataMgs);
  // console.log(firstPacketMemo);
  // TODO: Check last packet
  return (
    <Box marginTop="12px" marginBottom="25px">
      <Typography fontWeight="700">Token</Typography>
      <Grid container mt="10px" spacing={3}>
        <Grid item xs={12} md={3}>
          <TokenAvatar tokenName={sendToken} tokenImg={tokenImg} />
        </Grid>
        <Grid item xs={12} md={9}>
          <SendReceiveSection
            amount={sendAmount}
            sendToken={sendToken}
            sendTokenPath={sendTokenPath}
            receiveToken="ibc/BF3B4F53F3694B66E13C23107C84B6485BD2B96296BB7EC680EA77BBA75B4801"
            receiveTokenPath="transfer/channel-162/utia"
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default OverviewTransfers;
