import { useState } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  Box,
  Typography,
  IconButton,
  Collapse,
  Card,
  CardContent,
  Grid,
  useMediaQuery,
} from '@mui/material';
import ArrowDropUpIcon from '@mui/icons-material/KeyboardArrowUp';
import ArrowDropDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { shortenAddress } from '@src/utils/string';

type TransferInfoProps = {
  title: string;
  tag: string;
  icon: string;
};

const TransferInfo = ({ title, tag, icon }: TransferInfoProps) => {
  const dataRender = [
    {
      label: 'TxHash',
      value: 'DABD8D5225A3F7D47A21DB6FA0141E28FB54CB091D5E7B436CB13835F1C719B2',
    },
    {
      label: 'Status',
      value: 'Success',
    },
    {
      label: 'Fee',
      value: '0.000847 STRD',
    },
    {
      label: 'Signer',
      value: 'stride1c5szhgwd48peyarrus03fhddekekrseq87x3km',
    },
    {
      label: 'Memo',
      value:
        'Inter Blockchain Services Relayer | hermes 1.8.2+d223dd1e (https://hermes.informal.systems)',
    },
    {
      label: 'Block',
      value: '21497531',
    },
    {
      label: 'Time',
      value: '2024-07-29 05:24:55 (> 18 mins 3 secs ago)',
    },
    {
      label: 'Proof Height',
      value: '1-18580820',
    },
    {
      label: 'Raw data',
      value: '',
    },
  ];
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('md'));
  const [open, setOpen] = useState(false);

  const handleToggle = () => {
    setOpen(!open);
  };

  const renderStatus = (status: string) => {
    switch (status) {
      case 'Success':
        return (
          <Typography fontSize="14px" fontWeight={600} color="#038705">
            Success
          </Typography>
        );
      case 'Failed':
        return (
          <Typography fontSize="14px" fontWeight={600} color="#C42712">
            Failed
          </Typography>
        );
      default:
        return null;
    }
  };

  const renderValue = (data: { label: string; value: string }[]) => {
    return data.map((dt) => {
      return (
        <Grid container item xs={12}>
          <Grid item container>
            <Grid item xs={5} sm={3} md={2}>
              <Typography fontSize="14px" fontWeight="600">
                {`${dt.label}:`}
              </Typography>
            </Grid>
            <Grid item xs={7} sm={9} md={10}>
              {dt.label === 'Status' ? (
                renderStatus(dt.value)
              ) : (
                <Typography fontSize="14px">{dt.value}</Typography>
              )}
            </Grid>
          </Grid>
        </Grid>
      );
    });
  };
  return (
    <Card variant="outlined" sx={{ marginTop: '20px', borderRadius: '12px' }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        p={1}
        bgcolor="#F5F7F9"
      >
        <Box display="flex" gap="10px">
          <img src={icon} alt="transfer-icon" />
          <Typography display="flex" alignItems="center" fontWeight={600}>
            {title}
          </Typography>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            bgcolor="#E9ECF1"
            borderRadius={5}
            padding="2px 15px"
            fontSize="12px"
            fontWeight={600}
          >
            {tag}
          </Box>
        </Box>
        <IconButton onClick={handleToggle}>
          {open ? <ArrowDropUpIcon /> : <ArrowDropDownIcon />}
        </IconButton>
      </Box>
      <Box overflow="scroll">
        <CardContent>
          <Grid container spacing={2}>
            {renderValue(dataRender.slice(0, 3))}
          </Grid>
        </CardContent>
        <Collapse in={open} timeout="auto" unmountOnExit>
          <CardContent sx={{ paddingTop: 0 }}>
            <Grid container spacing={2}>
              {renderValue(dataRender.slice(3, dataRender.length))}
            </Grid>
          </CardContent>
        </Collapse>
      </Box>
    </Card>
  );
};

export default TransferInfo;
