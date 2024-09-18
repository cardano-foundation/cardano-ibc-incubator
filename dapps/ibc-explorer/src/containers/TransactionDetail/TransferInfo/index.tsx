import { useState } from 'react';
import dayjs from 'dayjs';
import ReactJson from 'react-json-view';
import axios from 'axios';

import {
  Box,
  Typography,
  IconButton,
  Collapse,
  Card,
  CardContent,
  Grid,
} from '@mui/material';
import ArrowDropUpIcon from '@mui/icons-material/KeyboardArrowUp';
import ArrowDropDownIcon from '@mui/icons-material/KeyboardArrowDown';
import {
  chainsMapping,
  chainsRestEndpoints,
} from '@src/configs/customChainInfo';

type TransferInfoProps = {
  title: string;
  tag: string;
  icon: string;
  msg: any;
};

const TransferInfo = ({ title, tag, icon, msg }: TransferInfoProps) => {
  const [open, setOpen] = useState(false);
  const [rawDataStr, setRawDataStr] = useState(msg?.data || '{}');

  const txTime = dayjs(Number(msg.time));
  const msgId = msg.id;
  const fromChainId = msgId.split('_')[0];

  const chainRestRpc = chainsRestEndpoints?.[fromChainId];

  const chainPrettyName = chainsMapping[fromChainId]?.pretty_name;
  const feeCurrency = chainsMapping[fromChainId]?.fees?.fee_tokens?.[0]?.denom;
  const dataRender = [
    {
      label: 'TxHash',
      value: msg?.txHash,
    },
    {
      label: 'Status',
      value: msg?.code === '0' || msg?.code === null ? 'Success' : 'Failed',
    },
    {
      label: 'Time',
      value: txTime.format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      label: 'Chain',
      value: chainPrettyName,
    },
    {
      label: 'Fee',
      value: `${msg?.gas} ${feeCurrency.toUpperCase()}`,
    },
    {
      label: 'Signer',
      value: msg?.sender,
    },
    {
      label: 'Raw data',
      value: rawDataStr,
    },
  ];

  const fetchTxData = async () => {
    const url = `${chainRestRpc}/cosmos/tx/v1beta1/txs/${msg?.txHash}`;
    const txData = await axios.get(url);
    setRawDataStr(JSON.stringify(txData.data.tx_response));
  };
  const handleToggle = () => {
    setOpen(!open);
    if (
      rawDataStr === '{}' &&
      chainRestRpc &&
      fromChainId !== process.env.REACT_APP_CARDANO_CHAIN_ID
    ) {
      fetchTxData();
    }
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
      const valueComponent = () => {
        switch (dt.label) {
          case 'Raw data':
            return <ReactJson src={JSON.parse(dt?.value || '{}')} collapsed />;
          case 'Status':
            return renderStatus(dt.value);
          default:
            return <Typography fontSize="14px">{dt.value}</Typography>;
        }
      };
      return (
        <Grid container item xs={12} key={JSON.stringify(dt)}>
          <Grid item container>
            <Grid item xs={5} sm={3} md={2}>
              <Typography fontSize="14px" fontWeight="600">
                {`${dt.label}:`}
              </Typography>
            </Grid>
            <Grid item xs={7} sm={9} md={10}>
              {valueComponent()}
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
            {renderValue(dataRender.slice(0, 4))}
          </Grid>
        </CardContent>
        <Collapse in={open} timeout="auto" unmountOnExit>
          <CardContent sx={{ paddingTop: 0 }}>
            <Grid container spacing={2}>
              {renderValue(dataRender.slice(4, dataRender.length))}
            </Grid>
          </CardContent>
        </Collapse>
      </Box>
    </Card>
  );
};

export default TransferInfo;
