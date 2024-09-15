import { Typography, Box } from '@mui/material';
import { chainsMapping } from '@src/configs/customChainInfo';
import { shortenAddress } from '@src/utils/string';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { StyledChip } from '../AddressInfo/index.style';

const Relayer = ({
  packetSequence,
  address1,
  chainId1,
  address2,
  chainId2,
}: {
  packetSequence: string;
  address1: string;
  chainId1: string;
  address2: string;
  chainId2: string;
}) => {
  const chainData1 = chainsMapping?.[chainId1] || {};
  const chainName1 = chainData1?.pretty_name || chainId1;
  const chainData2 = chainsMapping?.[chainId2] || {};
  const chainName2 = chainData2?.pretty_name || chainId2;

  const handleCopyAddressToClipboard = (address: string) => {
    navigator.clipboard.writeText(address);
  };

  return (
    <Box flex="1">
      <Typography fontWeight={600} mb={1}>
        Relayer
      </Typography>
      <Box
        display="flex"
        maxHeight="298px"
        flexDirection="column"
        justifyContent="space-between"
      >
        <Box
          display="flex"
          flexDirection="column"
          gap={1}
          padding={2}
          bgcolor="#F5F7F9"
          borderRadius="12px"
        >
          <Typography fontSize="14px" fontWeight={700}>
            {`${chainName1} Address`}
          </Typography>
          {address1 ? (
            <StyledChip
              label={shortenAddress(address1)}
              onDelete={() => {
                handleCopyAddressToClipboard(address1);
              }}
              sx={{
                justifyContent: 'start',
                maxWidth: 'max-content',
              }}
              variant="outlined"
              deleteIcon={<ContentCopyIcon />}
            />
          ) : (
            <Typography fontSize="14px">--</Typography>
          )}
          <Typography fontSize="14px" fontWeight={700}>
            {`${chainName2} Address`}
          </Typography>
          {address2 ? (
            <StyledChip
              label={shortenAddress(address2)}
              onDelete={() => {
                handleCopyAddressToClipboard(address2);
              }}
              sx={{
                justifyContent: 'start',
                maxWidth: 'max-content',
              }}
              variant="outlined"
              deleteIcon={<ContentCopyIcon />}
            />
          ) : (
            <Typography fontSize="14px">--</Typography>
          )}

          <Typography fontSize="14px" fontWeight={700}>
            Packet Sequence
          </Typography>
          <Typography>{packetSequence}</Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default Relayer;
