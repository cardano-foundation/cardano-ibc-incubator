import { MsgChannelOpenAck } from '@plus/proto-types/build/ibc/core/channel/v1/tx';

class MsgChannelOpenAckBuilder {
  private msgChannelOpenAck: MsgChannelOpenAck;

  constructor() {
    this.setDefault();
  }

  private setDefault(): void {
    this.msgChannelOpenAck = {
      port_id: 'port-100',
      channel_id: 'channel-9',
      counterparty_channel_id: 'channel-38',
      counterparty_version: 'ics20-1',
      proof_try: Buffer.from(
        '0ae6060ae3060a2e6368616e6e656c456e64732f706f7274732f7472616e736665722f6368616e6e656c732f6368616e6e656c2d33381233080210011a150a08706f72742d31303012096368616e6e656c2d39220d636f6e6e656374696f6e2d34332a0769637332302d311a0d0801180120012a050002bcce15222b080112270204bcce1520c6456e9d9dca1a66beb03799250db8aa0d2803566792af8c54a97d39896548d920222d080112060406bcce15201a21206d4c853e0f91d2b538429f31be28e6282229845659d998f0332d7413e32af629222b08011227060abcce15201bd31bce4668ca1a3efb017076d7e3b1b3ae7640ced9b8e4644375389c2134af20222b080112270812bcce15205e1f51c26b3d3294865820913cc9f47c1dfb7880a42bff467ee744841c89112520222b080112270a2cbcce1520216f44ff724feb1ef745de6822541b24f62b0bd52d5bfce3ff0d9995d14ad42620222b080112270c42bcce1520f468dcae1897de7f25897f70b16743a96253a3c966a049adbfd587757d2e46fa20222d080112060e6cbcce15201a21207873bf146f4ef2fd6e2eed43034006f3b964a74b2157a3424bba1ac8b21c7564222e08011207108c02bcce15201a2120820abe584404143d54e020fc3a2542cb855268c1ba14dba762950557e88a3236222c0801122812d603bcce152070caee6871a3531e15b67c4c33e888c04ed722f48acb8c5cd7beaa8020c1800e20222e0801120714d205bcce15201a2120de85b3642180a382d2cb315975de17355716a1ee2a5b5602f991451032647a98222e0801120716a60abcce15201a21200171e3d005092dd8fbacd9521fa8accf8df1d230b7a43ce0b7af7b3c7324a06b222e0801120718a019bcce15201a21209778591a619fd686bdc2d66f561caca678ed13b5a48e3cc8e3e42435e7ef700b222e080112071ab841bcce15201a212015c7f02606d98dff8312d2bbee6bcdda4bf6b3a1a966afb07c2f345fb8b07a4b222e080112071cc276bcce15201a21201f2f008cad4a9d8a1f8c74a29e6aa2cb11936fa1db60940b5ae1d510e9de6049222f080112081eecea01bcce15201a212074656baa323450ee7970ee7b1cbe35a006047b5bdf43226b390a76358b7d0990222f0801120820ead802bcce15201a212015a2794c4eea4a4e14a1b64fad9b94f71c38008ea849d8d06dc983919c6d6a290afc010af9010a03696263122055a29638a0a9dcf76a1487d1718e706be62bbed856a6ef33aa15a8c3c044e8941a090801180120012a01002225080112210106b99c0d8119ff1edbcbe165d0f19337dbbc080e677c88e57aa2ae767ebf0f0f222708011201011a20f03e9a3a8125b3030d3da809a5065fb5f4fb91ae04b45c455218f4844614fc482225080112210124409a1441553dd16e3e14d0545222d206e3deaf20e7556054ed528c9f5d8eed22250801122101a4e68cb4f278192ffa5b17020ee16d6109cc90e4025a94da8b16e0e992090ec1222708011201011a201dce889c650ee69c42e3c6a77db71e7cc4cebc3219f640a002f4f2a9c09ebb52',
        'hex',
      ),
      proof_height: { revision_height: 224576n, revision_number: 0n },
      signer: 'addr_test1vqj82u9chf7uwf0flum7jatms9ytf4dpyk2cakkzl4zp0wqgsqnql',
    };
  }

  reset(): void {
    this.setDefault();
  }

  withPortId(portId: string): MsgChannelOpenAckBuilder {
    this.msgChannelOpenAck.port_id = portId;
    return this;
  }

  withChannelId(channelId: string): MsgChannelOpenAckBuilder {
    this.msgChannelOpenAck.channel_id = channelId;
    return this;
  }

  withCounterpartyChannelId(counterpartyChannelId: string): MsgChannelOpenAckBuilder {
    this.msgChannelOpenAck.counterparty_channel_id = counterpartyChannelId;
    return this;
  }

  withCounterpartyVersion(counterpartyVersion: string): MsgChannelOpenAckBuilder {
    this.msgChannelOpenAck.counterparty_version = counterpartyVersion;
    return this;
  }

  withProofTry(proofTry: Buffer): MsgChannelOpenAckBuilder {
    this.msgChannelOpenAck.proof_try = proofTry;
    return this;
  }

  withProofHeight(revisionHeight: bigint, revisionNumber: bigint): MsgChannelOpenAckBuilder {
    this.msgChannelOpenAck.proof_height.revision_height = revisionHeight;
    this.msgChannelOpenAck.proof_height.revision_number = revisionNumber;
    return this;
  }

  withSigner(signer: string): MsgChannelOpenAckBuilder {
    this.msgChannelOpenAck.signer = signer;
    return this;
  }

  build(): any {
    const builtMsgChannelOpenAck = { ...this.msgChannelOpenAck };
    this.reset();
    return builtMsgChannelOpenAck;
  }
}

const msgChannelOpenAckBuilder = new MsgChannelOpenAckBuilder();

export default msgChannelOpenAckBuilder;
