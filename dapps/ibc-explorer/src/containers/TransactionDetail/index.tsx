import { useParams, useHistory } from 'react-router-dom';
import {
  Alert,
  Box,
  CircularProgress,
  Divider,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { HeaderTitle } from '@src/components/HeaderTitle';
import { StyledBasicInfo, StyledWrapperCointainer } from './index.style';
import { useTransactionDetail } from './useTransactionDetail';
import PacketMgsSection from './TransferInfo/PacketMgsSection';
import PacketsOverview from './Packets/PacketsOverview';
import PacketDisplay from './Packets/PacketDisplay';

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
        <StyledWrapperCointainer style={{ textAlign: 'center' }}>
          <CircularProgress />
        </StyledWrapperCointainer>
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
        <Alert icon={false} severity="error" className="alert-error">
          failed to execute message; message index: 0: spendable balance
          96023318ibc/498A0751C798A0D9A389AA3691123DADA57D is smaller than
          711533928ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4:
          insufficient funds
        </Alert>
        <StyledBasicInfo>
          <PacketsOverview
            packetList={packetList}
            packetsData={packetsData}
            packetDataMgs={packetDataMgs}
          />
          {packetList.length > 0 &&
            packetList.map((packet) => (
              <PacketDisplay
                key={packet}
                packetId={packet}
                packetList={packetList}
                packetsData={packetsData}
                packetDataMgs={packetDataMgs}
              />
            ))}
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
