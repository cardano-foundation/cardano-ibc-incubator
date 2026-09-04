export type SubmitOnlyTendermintSessionKind = 'init' | 'advance' | 'cancel';

export type SubmitOnlyTendermintSessionTx = {
  kind: SubmitOnlyTendermintSessionKind;
  sessionTokenName: string;
};

export type SubmitOnlyEligibilityConfig = {
  sessionPolicyId: string;
  sessionAddress: string;
  hostStatePolicyId: string;
  hostStateTokenName: string;
};

/**
 * Recovery-safe structural guard for SubmitSignedTxRequest.submit_only.
 *
 * A node-accepted transaction may bypass history confirmation only when its
 * body has one of the exact staged-session shapes: mint+create (init), preserve
 * one session NFT (advance), or burn+remove (cancel). A finalization transaction
 * is rejected because it necessarily carries the HostState NFT in an output.
 */
export function assertSubmitOnlyTendermintSessionTx(
  signedTxCbor: string,
  CML: any,
  config: SubmitOnlyEligibilityConfig,
): SubmitOnlyTendermintSessionTx {
  let transaction: any;
  try {
    transaction = CML.Transaction.from_cbor_hex(signedTxCbor);
  } catch (error) {
    throw new Error(`Cannot decode signed Cardano transaction: ${error?.message ?? error}`);
  }

  const body = transaction.body();
  const outputs = body.outputs();
  const sessionPolicy = CML.ScriptHash.from_hex(config.sessionPolicyId);
  const hostStatePolicy = CML.ScriptHash.from_hex(config.hostStatePolicyId);
  const hostStateTokenName = CML.AssetName.from_hex(config.hostStateTokenName);
  const sessionAddressHex = CML.Address.from_bech32(config.sessionAddress).to_hex();

  let outputSessionTokenName: string | undefined;
  for (let index = 0; index < outputs.len(); index += 1) {
    const output = outputs.get(index);
    const multiAsset = output.amount().multi_asset();

    if (multiAsset.get(hostStatePolicy, hostStateTokenName) !== undefined) {
      throw new Error('submit_only is forbidden for a transaction carrying the HostState NFT');
    }

    const sessionAssets = multiAsset.get_assets(sessionPolicy);
    if (!sessionAssets || sessionAssets.len() === 0) continue;

    if (output.address().to_hex() !== sessionAddressHex) {
      throw new Error('Session-policy asset is not locked at the configured session address');
    }
    if (outputSessionTokenName || sessionAssets.len() !== 1) {
      throw new Error('Expected exactly one staged Tendermint session NFT output');
    }

    const tokenName = sessionAssets.keys().get(0);
    const tokenNameHex = tokenName.to_hex();
    if (tokenNameHex.length !== 64 || sessionAssets.get(tokenName) !== 1n || !output.datum()?.as_datum?.()) {
      throw new Error('Malformed staged Tendermint session NFT output');
    }
    outputSessionTokenName = tokenNameHex;
  }

  const mint = body.mint();
  const sessionMintAssets = mint?.get_assets(sessionPolicy);
  if (!sessionMintAssets || sessionMintAssets.len() === 0) {
    if (mint && mint.policy_count() !== 0) {
      throw new Error('A staged Tendermint session advance must not mint or burn assets');
    }
    if (!outputSessionTokenName) {
      throw new Error('A staged Tendermint session advance must preserve its session NFT output');
    }
    return { kind: 'advance', sessionTokenName: outputSessionTokenName };
  }

  if (mint.policy_count() !== 1 || sessionMintAssets.len() !== 1) {
    throw new Error('A staged Tendermint session init/cancel must only mint or burn one session NFT');
  }

  const mintedTokenName = sessionMintAssets.keys().get(0);
  const mintedTokenNameHex = mintedTokenName.to_hex();
  const quantity = sessionMintAssets.get(mintedTokenName);
  if (mintedTokenNameHex.length !== 64) {
    throw new Error('Malformed staged Tendermint session token name');
  }

  if (quantity === 1n && outputSessionTokenName === mintedTokenNameHex) {
    return { kind: 'init', sessionTokenName: mintedTokenNameHex };
  }
  if (quantity === -1n && outputSessionTokenName === undefined) {
    return { kind: 'cancel', sessionTokenName: mintedTokenNameHex };
  }

  throw new Error('Session NFT mint/burn does not match a staged Tendermint init or cancel body');
}
