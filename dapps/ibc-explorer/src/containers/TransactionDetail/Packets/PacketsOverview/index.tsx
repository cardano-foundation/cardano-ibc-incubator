import { Divider, Typography } from '@mui/material';
import {
  CARDANO_DEFAULT_TRANSFER_PORT,
  DEFAULT_TRANSFER_PORT,
} from '@src/constants';
import OverviewTransfers from './OverviewTransfers';

const PacketsOverview = ({
  packetList,
  packetsData,
  packetDataMgs,
}: {
  packetList: string[];
  packetsData: { [key: string]: any };
  packetDataMgs: { [key: string]: any };
}) => {
  const firstPacket = packetList?.[0];
  const firstPacketData = packetsData?.[firstPacket] || {};
  const srcPort = firstPacketData?.srcPort;
  switch (srcPort) {
    case DEFAULT_TRANSFER_PORT:
    case CARDANO_DEFAULT_TRANSFER_PORT:
      return (
        <>
          <Typography fontWeight="700" mb="8px" fontSize="18px">
            Basic Info
          </Typography>
          <Divider />
          <OverviewTransfers
            packetList={packetList}
            packetsData={packetsData}
            packetDataMgs={packetDataMgs}
          />
        </>
      );
    default:
      return <></>;
  }
};
export default PacketsOverview;
