import TransferIcon from '@src/assets/logo/transfer-icon.svg';
import ReceiveIcon from '@src/assets/logo/receive-icon.svg';
import AcknowledgeIcon from '@src/assets/logo/acknowledge-icon.svg';
import { Divider } from '@mui/material';

import TransferInfo from '.';
import { usePacketMgs } from './usePacketMgs';

type PacketMgsSectionProps = {
  packetId: string;
  updatePacketDataMsg: (packetId: string, data: any) => void;
};
const PacketMgsSection = ({
  packetId,
  updatePacketDataMsg,
}: PacketMgsSectionProps) => {
  const { loading, msgs } = usePacketMgs({ packetId, updatePacketDataMsg });
  if (loading) {
    return <h3>{`Loading ${packetId} msg`}</h3>;
  }
  return (
    <>
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
