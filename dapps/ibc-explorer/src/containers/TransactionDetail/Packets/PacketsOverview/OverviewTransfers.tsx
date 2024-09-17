import { sha256 } from 'js-sha256';
import { Box, Grid, Typography } from '@mui/material';
import TokenAvatar from '@src/containers/TransactionDetail/TokenAvatar';
import SendReceiveSection from '@src/containers/TransactionDetail/SendReceiveSection';
import {
  CARDANO_LOVELACE_HEX,
  findTokenImg,
} from '@src/configs/customChainInfo';
import { getNumPkgNeeded } from '@src/utils/helper';

const NO_DATA = '--';

const ibcTokenFromPath = (chainId: string, tokenPath: string): string => {
  if (chainId === process.env.REACT_APP_CARDANO_CHAIN_ID) return tokenPath;
  if (!tokenPath.includes('/')) return tokenPath;
  return `ibc/${sha256(tokenPath)}`;
};

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
  let firstPacketDataInfo;

  try {
    firstPacketDataInfo = JSON.parse(firstPacketData?.data || '{}');
  } catch (e) {
    if (!firstPacketDataInfo?.denom) {
      return <></>;
    }
  }

  const sendAmount = firstPacketDataInfo?.amount || NO_DATA;
  let sendToken = firstPacketDataInfo?.denom;
  const sendTokenPath = firstPacketDataInfo?.denom;
  if (sendToken.toLowerCase() === CARDANO_LOVELACE_HEX) {
    sendToken = 'lovelace';
  }
  const sendTokenIBC = ibcTokenFromPath(firstPacketData?.srcChain, sendToken);
  const tokenImg = findTokenImg(firstPacketData?.srcChain, sendTokenPath);
  const firstPacketMemoStr = firstPacketDataInfo?.memo || '{}';
  isSwap = (firstPacketMemoStr.match(/osmosis_swap/g) || []).length > 0;
  let receiveAmount = NO_DATA;
  let receiveToken = NO_DATA;
  let receiveTokenPath = NO_DATA;

  const numPkgNeeded = getNumPkgNeeded(firstPacketMemoStr);
  if (numPkgNeeded === packetList.length) {
    const lastPacket = packetList?.[packetList.length - 1];
    const lastPacketRecvData =
      (packetDataMgs?.[lastPacket] || {})?.RecvPacket?.data || '';
    if (lastPacketRecvData && lastPacketRecvData.includes('transfer')) {
      try {
        const lastPacketRecvDataObj = JSON.parse(lastPacketRecvData);
        const lastTransferData = lastPacketRecvDataObj?.transfer;
        receiveAmount = lastTransferData?.out?.amount || NO_DATA;
        receiveToken = lastTransferData?.out?.token || NO_DATA;
        receiveTokenPath = lastTransferData?.out?.path || NO_DATA;
      } catch (e) {
        console.log(e);
      }
    }
  }

  const title = `Transfer ${isSwap ? 'and swap' : ''}`;
  return (
    <Box marginTop="12px" marginBottom="25px">
      <Typography fontWeight="700">{title}</Typography>
      <Grid container mt="10px" spacing={3}>
        <Grid item xs={12} md={3}>
          <TokenAvatar tokenName={sendTokenPath} tokenImg={tokenImg} />
        </Grid>
        <Grid item xs={12} md={9}>
          <SendReceiveSection
            amount={sendAmount}
            sendToken={sendTokenIBC}
            sendTokenPath={sendTokenPath}
            receiveAmount={receiveAmount}
            receiveToken={receiveToken}
            receiveTokenPath={receiveTokenPath}
          />
        </Grid>
      </Grid>
    </Box>
  );
};

export default OverviewTransfers;
