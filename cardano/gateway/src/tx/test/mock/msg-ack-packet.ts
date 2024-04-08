import { MsgAcknowledgement } from '@cosmjs-types/src/ibc/core/channel/v1/tx';

class MsgAcknowledgePacketMockBuilder {
  private msgAcknowledgePacket: MsgAcknowledgement;

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.msgAcknowledgePacket = {
      packet: {
        sequence: 3n,
        source_port: 'port-100',
        source_channel: 'channel-14',
        destination_port: 'transfer',
        destination_channel: 'channel-44',
        data: Buffer.from(
          '7b22616d6f756e74223a2232303030222c2264656e6f6d223a227374616b65222c227265636569766572223a223234373537306238626137646337323565396666333765393735376238313438623464356131323539353865646163326664343431376238222c2273656e646572223a22636f736d6f73317963656c353361356439786b3839713376647237766d383339743276776c3038706c367a6b36227d',
          'hex',
        ),
        timeout_height: null,
        timeout_timestamp: 1537768881398584830n,
      },
      acknowledgement: Buffer.from('7b22726573756c74223a2241513d3d227d', 'hex'),
      proof_acked: Buffer.from(
        '0ad9060ad6060a3361636b732f706f7274732f7472616e736665722f6368616e6e656c732f6368616e6e656c2d34342f73657175656e6365732f33122008f7557ed51826fe18d84512bf24ec75001edbaf2123a477df72a0a9f3640a7c1a0d0801180120012a05000282e318222b08011227020482e31820ef37b7fe73fa4366b4e34f97f5d904c284229f85932588a764fce44b3a679bc720222b08011227040682e31820ba5df6c5c086142f0e6074cf7faceba62cef4575c96b7fe981ae16f82779b6c020222d08011206060a82e318201a21207af823e045dcac855ae8aa7c54c50be5c6cd501025a2089ea529dfc1c9443518222b08011227081682e3182046d64656ff5ed8181ca19c33a45cd325d66f62ca5f6719ae452227060ab6b47820222b080112270a3082e31820cd6c4f14474d8b11efa9117c37b5caad739dec8161eb8271dbe9b26a967ce78720222b080112270c6082e31820ad240a9110b17996d395c765f6a51d27101ce36e733cf085bec7bd652001e7b020222e080112070e8a0182e318201a212026c2ed5d3a6246fad0048af130a679b2ae24cb53f412f18f20dd1ea5692a4f00222c0801122810da0182e318209ac4748cabfda1d9368744a3a27b5e50bcc0a345eedf8e15d2a6e68c5164c87320222e0801120712f20382e318201a2120404cebf08bb753a2a110d6d659f0ce02917f0ffa26f459672891506896419e3e222e0801120714ee0582e318201a2120de85b3642180a382d2cb315975de17355716a1ee2a5b5602f991451032647a98222e0801120716c20a82e318201a21200171e3d005092dd8fbacd9521fa8accf8df1d230b7a43ce0b7af7b3c7324a06b222e0801120718bc1982e318201a21209778591a619fd686bdc2d66f561caca678ed13b5a48e3cc8e3e42435e7ef700b222e080112071ad44182e318201a212015c7f02606d98dff8312d2bbee6bcdda4bf6b3a1a966afb07c2f345fb8b07a4b222e080112071cde7682e318201a21201f2f008cad4a9d8a1f8c74a29e6aa2cb11936fa1db60940b5ae1d510e9de6049222f080112081e88eb0182e318201a212074656baa323450ee7970ee7b1cbe35a006047b5bdf43226b390a76358b7d0990222f0801120820b2e80282e318201a2120771c23484d0cba267c4da6f73dc8f7c301e14a2357e86def7927e8601abf72fd0afc010af9010a036962631220abeee7548232e60530feb162b822e7e3f9732165c10232a978f1290bf4578fb11a090801180120012a01002225080112210106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f222708011201011a20f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc482225080112210124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed22250801122101fa03b0ca19ddf2f78c80de454b226149009ccff9feef34ab3f51348ed14dfc12222708011201011a2084a7b23561a3e8416829826d765daa07516b93737171af54c1910fa03347119d',
        'hex',
      ),
      proof_height: {
        revision_height: 224576n,
        revision_number: 0n,
      },
      signer: 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql',
    };
  }

  reset(): void {
    this.setDefault();
  }

  withSequence(sequence: bigint): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.packet.sequence = sequence;
    return this;
  }

  withSourcePort(sourcePort: string): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.packet.source_port = sourcePort;
    return this;
  }

  withSourceChannel(sourceChannel: string): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.packet.source_channel = sourceChannel;
    return this;
  }

  withDestinationPort(destinationPort: string): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.packet.destination_port = destinationPort;
    return this;
  }

  withDestinationChannel(destinationChannel: string): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.packet.destination_channel = destinationChannel;
    return this;
  }

  withData(data: Buffer): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.packet.data = data;
    return this;
  }

  withTimeoutTimestamp(timestamp: bigint): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.packet.timeout_timestamp = timestamp;
    return this;
  }

  withAcknowledgement(acknowledgement: Buffer): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.acknowledgement = acknowledgement;
    return this;
  }

  withProofAcked(proofAcked: Buffer): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.proof_acked = proofAcked;
    return this;
  }

  withProofHeight(revisionHeight: bigint, revisionNumber: bigint): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.proof_height.revision_height = revisionHeight;
    this.msgAcknowledgePacket.proof_height.revision_number = revisionNumber;
    return this;
  }

  withSigner(signer: string): MsgAcknowledgePacketMockBuilder {
    this.msgAcknowledgePacket.signer = signer;
    return this;
  }

  build(): any {
    const builtMsgAcknowledgePacket = { ...this.msgAcknowledgePacket };
    this.reset();
    return builtMsgAcknowledgePacket;
  }
}

const msgAcknowledgePacketMockBuilder = new MsgAcknowledgePacketMockBuilder();

export default msgAcknowledgePacketMockBuilder;
