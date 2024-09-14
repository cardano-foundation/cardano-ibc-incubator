import { useParams, useHistory } from 'react-router-dom';
import { Box, Divider, Grid, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { HeaderTitle } from '@src/components/HeaderTitle';
import DoubleArrowIcon from '@src/components/DoubleArrowIcon';
import SendReceiveSection from './SendReceiveSection';
import TokenAvatar from './TokenAvatar';
import AddressInfoCard from './AddressInfo';
import Relayer from './Relayer';
import { StyledBasicInfo, StyledWrapperCointainer } from './index.style';
import { useTransactionDetail } from './useTransactionDetail';
import PacketMgsSection from './TransferInfo/PacketMgsSection';

const TransactionDetail = () => {
  const theme = useTheme();
  const { txHash } = useParams<{ txHash: string }>();
  const history = useHistory();
  if (!txHash.trim()) {
    history.push('/');
  }
  const {
    loading,
    canLoadTx,
    packetList,
    packetsData,
    packetDataMgs,
    updatePacketDataMsg,
    calculateOverallPacketStatus,
  } = useTransactionDetail({
    txHash,
  });
  const matches = useMediaQuery(theme.breakpoints.down('md'));

  if (loading) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        bgcolor="#F5F7F9"
        paddingY={4}
        paddingX={matches ? 2 : undefined}
      >
        <StyledWrapperCointainer>loading...</StyledWrapperCointainer>
      </Box>
    );
  }

  if (!canLoadTx) {
    history.push('/');
  }

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      bgcolor="#F5F7F9"
      paddingY={4}
      paddingX={matches ? 2 : undefined}
    >
      <StyledWrapperCointainer>
        <Box mb={3}>
          <HeaderTitle
            title="IBC Packet Details"
            status={calculateOverallPacketStatus()}
          />
        </Box>
        <StyledBasicInfo>
          <Typography fontWeight="700" mb="8px" fontSize="18px">
            Basic Info
          </Typography>
          <Divider />
          <Box marginTop="12px">
            <Typography fontWeight="700">Token</Typography>
            <Grid container mt="10px" spacing={3}>
              <Grid item xs={12} md={3}>
                <TokenAvatar />
              </Grid>
              <Grid item xs={12} md={9}>
                <SendReceiveSection />
              </Grid>
            </Grid>
          </Box>
          <Grid
            container
            display="flex"
            justifyContent="space-between"
            gap="10px"
            paddingY="25px"
          >
            <Grid item xs={12} md={3.7}>
              <AddressInfoCard />
            </Grid>
            <Grid item xs={12} md={0.5} display="flex" justifyContent="center">
              <DoubleArrowIcon
                color="green"
                mt="30px"
                style={{ transform: matches ? 'rotate(90deg)' : undefined }}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <Relayer />
            </Grid>
            <Grid item xs={12} md={0.5} display="flex" justifyContent="center">
              <DoubleArrowIcon
                color="brown"
                mt="30px"
                style={{ transform: matches ? 'rotate(90deg)' : undefined }}
              />
            </Grid>
            <Grid item xs={12} md={3.7}>
              <AddressInfoCard fromOrTo="To" />
            </Grid>
          </Grid>
        </StyledBasicInfo>
      </StyledWrapperCointainer>

      <StyledWrapperCointainer>
        <StyledBasicInfo>
          <Typography fontWeight="700" mb="8px" fontSize="18px">
            Transactions Info
          </Typography>
          <Divider />
          {packetList.length > 0 &&
            packetList.map((packet) => (
              <PacketMgsSection
                packetId={packet}
                updatePacketDataMsg={updatePacketDataMsg}
                key={packetsData[packet].id}
              />
            ))}
        </StyledBasicInfo>
      </StyledWrapperCointainer>
    </Box>
  );
};

export default TransactionDetail;
