import { MsgRecvPacket } from '@cosmjs-types/src/ibc/core/channel/v1/tx';

class MsgRecvPacketMockBuilder {
  private msgRecvPacketMock: MsgRecvPacket;

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.msgRecvPacketMock = {
      packet: {
        sequence: 3n,
        source_port: 'transfer',
        source_channel: 'channel-44',
        destination_port: 'port-100',
        destination_channel: 'channel-14',
        data: Buffer.from(
          '7b22616d6f756e74223a2232303030222c2264656e6f6d223a227374616b65222c227265636569766572223a223234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238222c2273656e646572223a22636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b36227d',
          'hex',
        ),
        timeout_height: null,
        timeout_timestamp: 202906n,
      },
      proof_commitment: Buffer.from(
        '0afb050af8050a3a636f6d6d69746d656e74732f706f7274732f7472616e736665722f6368616e6e656c732f6368616e6e656c2d34342f73657175656e6365732f331220d026e393c2b9914b5ad4cbf4603aceb89da58e7dbc1cd05f8e6e102cf70b59281a0d0801180120012a050002b2e218222b080112270204b2e21820b3e13cd784da93a54197a215a14fd14ed7d1423bb6e064fbaeaba1d88d784a9520222b080112270406b2e2182038af5bd4db193276cb5c7bf13dde7a0a4613704e57d6ebd74fca97a4b726476f20222d08011206060ab2e218201a2120d9dd05fbbec05c33fbb911c023d714e4edbc3b7ecd79059367de0ec7cfde7ead222d080112060812b2e218201a2120fe21f828d81cd92df48f0d8c51ff77971f8d6080ec7e51e68474daea0446a75c222d080112060a2cb2e218201a21204a5c7c12dc0cf0b4415af970cfa71db1dc3d926e898894873bab4b91aaf88bc9222d080112060e7eb2e218201a212011f8ee89c0fb930f280f7263c8d763d58ff8df8e88ac5c03bbe687f45d98d8a0222c0801122810ce01b2e21820223751a7d9f6d480e6c925a78adc2b738ab6bf727323829c6cb6abb2f8a6e50e20222e08011207128403b2e218201a21207afeb35db8b2c4b807b855e5db0fca2e238ce8b0c72bc89d9a3dba8897df36e4222e0801120714b405b2e218201a212090f1639be283350c03677bcd34fbc6cf25d6cfb7f508fc86905ea233eb16d9ce222c0801122818da0fb2e218200d08e4e41adff601e4e0afe13ab39b8d3967efded7727f2d1186ef0ee6fcfb5620222c080112281ad229b2e21820a0cb1b69ceb4d73fe0422ce3652664b4dd6708e2e8bf20452f3d7f7fde0735c220222c080112281c9655b2e218203cbbcbcb0a7c2c2e7da8816135bdcdf28995e5ef948836363da67b387587ccbe20222c080112281ed07cb2e21820698cbcbeac7c27cdf486b62e17b555708d8c662d4d381c5d4d2de38018a21cbb20222d0801122920d6e702b2e2182092e8ef2388629c085d56e7d69ff977d05b2448261c18cae98d12e04cd927b7cc200afc010af9010a0369626312200ead67b345a1176c8d0350855926564e2545946f7a5db171d946b204a73b0abb1a090801180120012a01002225080112210106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f222708011201011a20f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc482225080112210124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed22250801122101716b6d39bbe11655af05c608b1100dd99c63d253ebfe4739023fd3be98845fec222708011201011a201442f25887ae1c59a572006ad696096c891843e7f9f76a20620906a66a3dcb1b',
        'hex',
      ),
      proof_height: { revision_height: 224576n, revision_number: 0n },
      signer: 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql',
    };
  }

  reset(): void {
    this.setDefault();
  }
  withSigner(signer: string): MsgRecvPacketMockBuilder {
    this.msgRecvPacketMock.signer = signer;
    return this;
  }
  withData(data: Buffer): MsgRecvPacketMockBuilder {
    this.msgRecvPacketMock.packet.data = data;
    return this;
  }
  withChannelId(channelId: string): MsgRecvPacketMockBuilder {
    this.msgRecvPacketMock.packet.destination_channel = channelId;
    return this;
  }
  withDestinationPort(destinationPort: string): MsgRecvPacketMockBuilder {
    this.msgRecvPacketMock.packet.destination_port = destinationPort;
    return this;
  }
  withProofHeight(revisionHeight: bigint, revisionNumber: bigint): MsgRecvPacketMockBuilder {
    this.msgRecvPacketMock.proof_height.revision_height = revisionHeight;
    this.msgRecvPacketMock.proof_height.revision_number = revisionNumber;
    return this;
  }
  build(): any {
    const builtMsgRecvPacketMock = { ...this.msgRecvPacketMock };
    this.reset();
    return builtMsgRecvPacketMock;
  }
}

const msgRecvPacketMockBuilder = new MsgRecvPacketMockBuilder();

export default msgRecvPacketMockBuilder;
