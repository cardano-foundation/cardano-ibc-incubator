import TransferIcon from '@src/assets/logo/transfer-icon.svg';
import ReceiveIcon from '@src/assets/logo/receive-icon.svg';
import AcknowledgeIcon from '@src/assets/logo/acknowledge-icon.svg';
import { CircularProgress, Divider, Card, Typography } from '@mui/material';
import { COLOR } from '@src/styles/color';
import { chainsMapping } from '@src/configs/customChainInfo';

import TransferInfo from '.';
import { usePacketMgs } from './usePacketMgs';

type PacketMgsSectionProps = {
  packetId: string;
  // eslint-disable-next-line no-unused-vars
  updatePacketDataMsg: (packetId: string, data: any) => void;
};
const PacketMgsSection = ({
  packetId,
  updatePacketDataMsg,
}: PacketMgsSectionProps) => {
  const { loading, msgs } = usePacketMgs({ packetId, updatePacketDataMsg });
  if (loading) {
    return (
      <Card
        variant="outlined"
        sx={{ marginTop: '20px', borderRadius: '12px', textAlign: 'center' }}
      >
        <CircularProgress />
      </Card>
    );
  }
  const [chainId, port, channel, sequence] = packetId.split('_');
  const chainData = chainsMapping?.[chainId] || {};
  const chainName = chainData?.pretty_name || chainId;
  const packetText = `Packet: ${sequence} (${port}/${channel}) from: ${chainName}`;
  return (
    <>
      <Typography
        fontSize={14}
        fontWeight={600}
        marginTop="12px"
        marginBottom="5px"
        lineHeight="18px"
        color={COLOR.neutral_1}
      >
        {packetText}
      </Typography>
      {msgs?.SendPacket && (
        <TransferInfo
          title="Transfer"
          tag="From"
          icon={TransferIcon}
          msg={msgs.SendPacket}
        />
      )}
      {msgs?.RecvPacket && (
        <TransferInfo
          title="Receive"
          tag="To"
          icon={ReceiveIcon}
          msg={msgs.RecvPacket}
        />
      )}
      {msgs?.AcknowledgePacket && (
        <TransferInfo
          title="Acknowledge"
          tag="Result"
          icon={AcknowledgeIcon}
          msg={msgs.AcknowledgePacket}
        />
      )}
      <Divider sx={{ marginTop: '15px' }} />
    </>
  );
};

export default PacketMgsSection;
