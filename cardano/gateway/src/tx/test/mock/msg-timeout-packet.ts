import { MsgTimeout } from '@plus/proto-types/build/ibc/core/channel/v1/tx';

class MsgTimeOutPacketMockBuilder {
  private msgTimeOutPacket: MsgTimeout;

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.msgTimeOutPacket = {
      packet: {
        sequence: 4n,
        source_port: 'port-100',
        source_channel: 'channel-14',
        destination_port: 'transfer',
        destination_channel: 'channel-44',
        data: Buffer.from(
          '7b22616d6f756e74223a2232303030222c2264656e6f6d223a227374616b65222c227265636569766572223a223234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238222c2273656e646572223a22636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b36227d',
          'hex',
        ),
        timeout_height: null,
        timeout_timestamp: 968124724398584011n,
      },
      proof_unreceived: Buffer.from(
        '0adf0b12dc0b0a3772656365697074732f706f7274732f7472616e736665722f6368616e6e656c732f6368616e6e656c2d34342f73657175656e6365732f3412f9050a3772656365697074732f706f7274732f7472616e736665722f6368616e6e656c732f6368616e6e656c2d34342f73657175656e6365732f331201011a0d0801180120012a05000282e318222b08011227020482e3182058fe2b7584b156d2805864fe36c2761b7004fc9168967e8c6daad6b255da625e20222b08011227040882e31820a92c7567701508197f4bb424d71be7fe2911234fbc1cf8c28f29d6ed3028674f20222b08011227060c82e318207ecd791d4cd963d91adcd3c92a83a59411057668e422d34970af0d260a6d18b620222b08011227081c82e31820e20105144f76c1152182d0872bd0f76704ee844e52120bb7a2c42dbf9e48fe5e20222b080112270a2c82e31820a11770f1f3248ce4b0b3227b100605b3eb3496abe2787b354ae08c47baaf87e520222b080112270c4482e31820f7410f593f142f7f63bce0eba9167c111e48e2824755f47a476cb3c8b2138ec520222d080112060e7082e318201a2120c4927f36cfcd507aeae2173d60e1c936df5c917322eb2bdbfd5a912fea1cba1c222c0801122810b20182e31820902968cdb6f5d1c455510e1f5721cdeb244e5274201e0d20b88e3a6cfc36a72920222c0801122812b202d4e31820a21b7331b43a7bb4c896228ab440d4e857d4397d8c666dec2f2ca1d87cfbdc0020222c0801122814b605d4e31820f918bff69ac3bb2c4ca4c4a4cd3bc5e138f358d6e450b927542fee645381d6be20222c08011228188e11e0e318201da70bdf2426f12b020bc50db86965552adfd4773f31e802e20be1ba5a36f41420222c080112281a862be0e31820a0cb1b69ceb4d73fe0422ce3652664b4dd6708e2e8bf20452f3d7f7fde0735c220222c080112281cca56e0e318203cbbcbcb0a7c2c2e7da8816135bdcdf28995e5ef948836363da67b387587ccbe20222c080112281e847ee0e31820698cbcbeac7c27cdf486b62e17b555708d8c662d4d381c5d4d2de38018a21cbb20222d08011229208ce902e0e31820d72985b97daddb42a039f74dd2b8845ce9254ba44e2dec3527e708b0281292bd201aa4050a3672656365697074732f706f7274732f7472616e736665722f6368616e6e656c732f6368616e6e656c2d352f73657175656e6365732f311201011a0d0801180120012a050002fced01222d080112060204eae403201a2120c0596a473f31b26eba1ef1ee881221ca6392fc916b574c7546c6a67946b0c68c222d080112060408e2ee03201a2120778efc2ef499fec29113fb8b6265bd146e1f502a591f25b59bebccf9cba9ceb7222d080112060610a0ae04201a2120760905e461cb962bd8195d4703f5dbcc2fdce110180ecddd4f26130850655429222d080112060a2cdab315201a21209310959bbb7e2ee0acd716ac08d395a9d02f3711ce598b5375c06ef4b7c9f405222b080112270e7082e31820f0680c8e38f4ab5e9ff91f47c25bbbd265653145bb17084ab826a0d81606a95120222c0801122810b20182e31820902968cdb6f5d1c455510e1f5721cdeb244e5274201e0d20b88e3a6cfc36a72920222c0801122812b202d4e31820a21b7331b43a7bb4c896228ab440d4e857d4397d8c666dec2f2ca1d87cfbdc0020222c0801122814b605d4e31820f918bff69ac3bb2c4ca4c4a4cd3bc5e138f358d6e450b927542fee645381d6be20222c08011228188e11e0e318201da70bdf2426f12b020bc50db86965552adfd4773f31e802e20be1ba5a36f41420222c080112281a862be0e31820a0cb1b69ceb4d73fe0422ce3652664b4dd6708e2e8bf20452f3d7f7fde0735c220222c080112281cca56e0e318203cbbcbcb0a7c2c2e7da8816135bdcdf28995e5ef948836363da67b387587ccbe20222c080112281e847ee0e31820698cbcbeac7c27cdf486b62e17b555708d8c662d4d381c5d4d2de38018a21cbb20222d08011229208ce902e0e31820d72985b97daddb42a039f74dd2b8845ce9254ba44e2dec3527e708b0281292bd200afc010af9010a036962631220500153c1200026a92122963da402879314d02bb0cda9cf57a0428b2b3c9617851a090801180120012a01002225080112210106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f222708011201011a20f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc482225080112210124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed22250801122101655d5991147e22a0d8b34bf4829a710f749b69609c986fa1cb156b031582390f222708011201011a20dab07ecb36a5b111e2787f849de8e787a49d1456bd961961cadd754fa381ab9b',
        'hex',
      ),
      proof_height: {
        revision_height: 224576n,
        revision_number: 0n,
      },
      next_sequence_recv: 4n,
      signer: 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql',
    };
  }

  reset(): void {
    this.setDefault();
  }

  withSequence(sequence: bigint): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.packet.sequence = sequence;
    return this;
  }

  withSourcePort(sourcePort: string): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.packet.source_port = sourcePort;
    return this;
  }

  withSourceChannel(sourceChannel: string): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.packet.source_channel = sourceChannel;
    return this;
  }

  withDestinationPort(destinationPort: string): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.packet.destination_port = destinationPort;
    return this;
  }

  withDestinationChannel(destinationChannel: string): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.packet.destination_channel = destinationChannel;
    return this;
  }

  withData(data: Buffer): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.packet.data = data;
    return this;
  }

  withTimeoutTimestamp(timestamp: bigint): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.packet.timeout_timestamp = timestamp;
    return this;
  }

  withProofUnreceived(proofUnreceived: Buffer): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.proof_unreceived = proofUnreceived;
    return this;
  }
  withProofHeight(revisionHeight: bigint, revisionNumber: bigint): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.proof_height.revision_height = revisionHeight;
    this.msgTimeOutPacket.proof_height.revision_number = revisionNumber;
    return this;
  }

  withNextSequenceRecv(nextSequenceRecv: bigint): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.next_sequence_recv = nextSequenceRecv;
    return this;
  }

  withSigner(signer: string): MsgTimeOutPacketMockBuilder {
    this.msgTimeOutPacket.signer = signer;
    return this;
  }

  build(): any {
    const builtMsgTimeOutPacket = { ...this.msgTimeOutPacket };
    this.reset();
    return builtMsgTimeOutPacket;
  }
}

const msgTimeOutPacketMockBuilder = new MsgTimeOutPacketMockBuilder();

export default msgTimeOutPacketMockBuilder;
