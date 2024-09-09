import { Box, Divider, Typography } from '@mui/material';

import { HeaderTitle } from '@src/components/HeaderTitle';
import DoubleArrowIcon from '@src/components/DoubleArrowIcon';
import TransferIcon from '@src/assets/logo/transfer-icon.svg';
import ReceiveIcon from '@src/assets/logo/receive-icon.svg';
import AcknowledgeIcon from '@src/assets/logo/acknowledge-icon.svg';
import SendReceiveSection from './SendReceiveSection';
import TokenAvatar from './TokenAvatar';
import AddressInfoCard from './AddressInfo';
import Relayer from './Relayer';
import TransferInfo from './TransferInfo';
import { StyledBasicInfo, StyledWrapperCointainer } from './index.style';

const TransactionDetail = () => {
  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      bgcolor="#F5F7F9"
      paddingY={4}
    >
      <StyledWrapperCointainer>
        <Box mb={3}>
          <HeaderTitle title="IBC Packet Details" status="processing" />
        </Box>
        <StyledBasicInfo>
          <Typography fontWeight="700" mb="8px" fontSize="18px">
            Basic Info
          </Typography>
          <Divider />
          <Box marginTop="12px">
            <Typography fontWeight="700">Token</Typography>
            <Box display="flex" gap={7} mt="10px">
              <TokenAvatar />
              <SendReceiveSection />
            </Box>
          </Box>
          <Box
            display="flex"
            justifyContent="space-between"
            gap="10px"
            paddingY="25px"
          >
            <AddressInfoCard />
            <DoubleArrowIcon color="green" mt="30px" />
            <Relayer />
            <DoubleArrowIcon color="brown" mt="30px" />
            <AddressInfoCard fromOrTo="To" />
          </Box>
        </StyledBasicInfo>
      </StyledWrapperCointainer>

      <StyledWrapperCointainer>
        <StyledBasicInfo>
          <Typography fontWeight="700" mb="8px" fontSize="18px">
            Basic Info
          </Typography>
          <Divider />
          <TransferInfo title="Transfer" tag="From" icon={TransferIcon} />
          <TransferInfo title="Receive" tag="To" icon={ReceiveIcon} />
          <TransferInfo
            title="Acknowledge"
            tag="Result"
            icon={AcknowledgeIcon}
          />
        </StyledBasicInfo>
      </StyledWrapperCointainer>
    </Box>
  );
};

export default TransactionDetail;
