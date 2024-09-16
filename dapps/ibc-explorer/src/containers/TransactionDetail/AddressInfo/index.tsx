import { Box, Typography, Grid } from '@mui/material';
import PropTypes from 'prop-types';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  CARDANO_MAINNET_MAGIC,
  chainsMapping,
} from '@src/configs/customChainInfo';

import { shortenAddress } from '@src/utils/string';
import { paymentCredToAddress } from '@src/utils/helper';

import { StyledChip } from './index.style';

const AddressInfoCard = ({
  fromOrTo = 'From',
  chainId,
  port,
  channel,
  address,
}: {
  fromOrTo: string;
  chainId: string;
  port: string;
  channel: string;
  address: string;
}) => {
  const chainData = chainsMapping?.[chainId] || {};
  const chainName = chainData?.pretty_name || chainId;
  const chainLogo = chainData?.logo_URIs?.svg;
  let addressToDisplay = address;
  if (chainId === process.env.REACT_APP_CARDANO_CHAIN_ID) {
    addressToDisplay = paymentCredToAddress(
      addressToDisplay,
      chainId === CARDANO_MAINNET_MAGIC,
    );
  }
  const data = {
    address: addressToDisplay,
    connectionInfo: [
      {
        label: 'Chain ID',
        value: chainId,
      },
      {
        label: 'Port',
        value: port,
      },
      {
        label: 'Channel ID',
        value: channel,
      },
    ],
  };

  const handleCopyAddressToClipboard = () => {
    navigator.clipboard.writeText(data.address);
  };
  return (
    <Box overflow="hidden">
      <Typography fontWeight={600} mb={1}>
        {fromOrTo}
      </Typography>
      <Box padding="15px" bgcolor="#F5F7F9" borderRadius="12px">
        <Typography variant="body2" fontSize="14px" fontWeight={700}>
          {`${chainName} Address`}
        </Typography>
        {data.address ? (
          <StyledChip
            label={shortenAddress(data.address)}
            onDelete={handleCopyAddressToClipboard}
            variant="outlined"
            deleteIcon={<ContentCopyIcon />}
          />
        ) : (
          <Typography fontSize="14px">--</Typography>
        )}

        <Grid container spacing={2} mt={1}>
          {data.connectionInfo.map((dt) => (
            <Grid item xs={6} key={JSON.stringify(dt)}>
              <Typography variant="body2" fontWeight={700}>
                {dt.label}
              </Typography>

              <Box display="flex" mt="3px" gap="5px">
                {dt.label === 'Chain ID' && (
                  <img height={32} src={chainLogo} alt="Logo" />
                )}
                <Typography display="flex" alignItems="center" variant="body1">
                  {dt.value}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>
    </Box>
  );
};

AddressInfoCard.propTypes = {
  fromOrTo: PropTypes.string,
};

export default AddressInfoCard;
