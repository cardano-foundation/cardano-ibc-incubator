import { Box, Typography, Grid } from '@mui/material';
import PropTypes from 'prop-types';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

import ChainIcon from '@src/assets/logo/chain-icon-fake.svg';
import { shortenAddress } from '@src/utils/string';
import { StyledChip } from './index.style';

const AddressInfoCard = ({ fromOrTo = 'From' }) => {
  const data = {
    address: 'stride1c5szhgwd48peyarrus03fhddekekrseq87x3km',
    connectionInfo: [
      {
        label: 'Chain ID',
        value: 'Stride-1',
      },
      {
        label: 'Port',
        value: 'transfer',
      },
      {
        label: 'Channel ID',
        value: 'channel-162',
      },
      {
        label: 'Connection ID',
        value: 'connection-125',
      },
      {
        label: 'Client ID',
        value: '07-tendermint-137',
      },
    ],
  };

  const handleCopyAddressToClipboard = () => {
    navigator.clipboard.writeText(data.address);
  };
  return (
    <Box maxWidth="31%" overflow="hidden">
      <Typography fontWeight={600} mb={1}>
        {fromOrTo}
      </Typography>
      <Box padding="15px" bgcolor="#F5F7F9" borderRadius="12px">
        <Typography variant="body2">Strike Address</Typography>
        <StyledChip
          label={shortenAddress(data.address)}
          onDelete={handleCopyAddressToClipboard}
          variant="outlined"
          deleteIcon={<ContentCopyIcon />}
        />
        <Grid container spacing={2} mt={1}>
          {data.connectionInfo.map((dt) => (
            <Grid item xs={6}>
              <Typography variant="body2" fontWeight={700}>
                {dt.label}
              </Typography>

              <Box display="flex" mt="3px" gap="5px">
                {dt.label === 'Chain ID' && (
                  <img height={32} src={ChainIcon} alt="Logo" />
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
