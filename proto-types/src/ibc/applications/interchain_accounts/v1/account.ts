/* eslint-disable */
import { BaseAccount } from "../../../../cosmos/auth/v1beta1/auth";
import { BinaryReader, BinaryWriter } from "../../../../binary";
import { isSet, DeepPartial, Exact } from "../../../../helpers";
export const protobufPackage = "ibc.applications.interchain_accounts.v1";
/** An InterchainAccount is defined as a BaseAccount & the address of the account owner on the controller chain */
export interface InterchainAccount {
  base_account?: BaseAccount;
  account_owner: string;
}
function createBaseInterchainAccount(): InterchainAccount {
  return {
    base_account: undefined,
    account_owner: ""
  };
}
export const InterchainAccount = {
  typeUrl: "/ibc.applications.interchain_accounts.v1.InterchainAccount",
  encode(message: InterchainAccount, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.base_account !== undefined) {
      BaseAccount.encode(message.base_account, writer.uint32(10).fork()).ldelim();
    }
    if (message.account_owner !== "") {
      writer.uint32(18).string(message.account_owner);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): InterchainAccount {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    let end = length === undefined ? reader.len : reader.pos + length;
    const message = createBaseInterchainAccount();
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.base_account = BaseAccount.decode(reader, reader.uint32());
          break;
        case 2:
          message.account_owner = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromJSON(object: any): InterchainAccount {
    const obj = createBaseInterchainAccount();
    if (isSet(object.base_account)) obj.base_account = BaseAccount.fromJSON(object.base_account);
    if (isSet(object.account_owner)) obj.account_owner = String(object.account_owner);
    return obj;
  },
  toJSON(message: InterchainAccount): unknown {
    const obj: any = {};
    message.base_account !== undefined && (obj.base_account = message.base_account ? BaseAccount.toJSON(message.base_account) : undefined);
    message.account_owner !== undefined && (obj.account_owner = message.account_owner);
    return obj;
  },
  fromPartial<I extends Exact<DeepPartial<InterchainAccount>, I>>(object: I): InterchainAccount {
    const message = createBaseInterchainAccount();
    if (object.base_account !== undefined && object.base_account !== null) {
      message.base_account = BaseAccount.fromPartial(object.base_account);
    }
    message.account_owner = object.account_owner ?? "";
    return message;
  }
};