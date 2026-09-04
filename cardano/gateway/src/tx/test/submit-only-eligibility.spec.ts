import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import { assertSubmitOnlyTendermintSessionTx } from '../submit-only-eligibility';

const SESSION_POLICY_ID = '11'.repeat(28);
const SESSION_TOKEN_NAME = '22'.repeat(32);
const HOST_STATE_POLICY_ID = '33'.repeat(28);
const HOST_STATE_TOKEN_NAME = '44'.repeat(8);

const sessionAddress = CML.EnterpriseAddress.new(0, CML.Credential.new_script(CML.ScriptHash.from_hex('55'.repeat(28))))
  .to_address()
  .to_bech32();
const otherAddress = CML.EnterpriseAddress.new(0, CML.Credential.new_script(CML.ScriptHash.from_hex('66'.repeat(28))))
  .to_address()
  .to_bech32();

const eligibilityConfig = {
  sessionPolicyId: SESSION_POLICY_ID,
  sessionAddress,
  hostStatePolicyId: HOST_STATE_POLICY_ID,
  hostStateTokenName: HOST_STATE_TOKEN_NAME,
};

function assetValue(policyId: string, tokenName: string): CML.Value {
  const assets = CML.MultiAsset.new();
  assets.set(CML.ScriptHash.from_hex(policyId), CML.AssetName.from_hex(tokenName), 1n);
  return CML.Value.new(2_000_000n, assets);
}

function transactionCbor({
  sessionOutput = false,
  sessionOutputAddress = sessionAddress,
  sessionMint,
  hostStateOutput = false,
  otherMint = false,
}: {
  sessionOutput?: boolean;
  sessionOutputAddress?: string;
  sessionMint?: bigint;
  hostStateOutput?: boolean;
  otherMint?: boolean;
}): string {
  const outputs = CML.TransactionOutputList.new();
  if (sessionOutput) {
    outputs.add(
      CML.TransactionOutput.new(
        CML.Address.from_bech32(sessionOutputAddress),
        assetValue(SESSION_POLICY_ID, SESSION_TOKEN_NAME),
        CML.DatumOption.new_datum(CML.PlutusData.new_bytes(Uint8Array.from([1]))),
      ),
    );
  }
  if (hostStateOutput) {
    outputs.add(
      CML.TransactionOutput.new(
        CML.Address.from_bech32(otherAddress),
        assetValue(HOST_STATE_POLICY_ID, HOST_STATE_TOKEN_NAME),
      ),
    );
  }

  const body = CML.TransactionBody.new(CML.TransactionInputList.new(), outputs, 0n);
  if (sessionMint !== undefined || otherMint) {
    const mint = CML.Mint.new();
    if (sessionMint !== undefined) {
      mint.set(CML.ScriptHash.from_hex(SESSION_POLICY_ID), CML.AssetName.from_hex(SESSION_TOKEN_NAME), sessionMint);
    }
    if (otherMint) {
      mint.set(CML.ScriptHash.from_hex('77'.repeat(28)), CML.AssetName.from_hex('88'), 1n);
    }
    body.set_mint(mint);
  }

  return CML.Transaction.new(body, CML.TransactionWitnessSet.new(), true).to_cbor_hex();
}

describe('submit-only staged Tendermint structural guard', () => {
  it.each([
    ['init', transactionCbor({ sessionOutput: true, sessionMint: 1n })],
    ['advance', transactionCbor({ sessionOutput: true })],
    ['cancel', transactionCbor({ sessionMint: -1n })],
  ] as const)('accepts a structurally valid %s transaction', (kind, cbor) => {
    expect(assertSubmitOnlyTendermintSessionTx(cbor, CML, eligibilityConfig)).toEqual({
      kind,
      sessionTokenName: SESSION_TOKEN_NAME,
    });
  });

  it('rejects finalization even though it burns the session NFT', () => {
    const cbor = transactionCbor({
      sessionMint: -1n,
      hostStateOutput: true,
    });

    expect(() => assertSubmitOnlyTendermintSessionTx(cbor, CML, eligibilityConfig)).toThrow('HostState NFT');
  });

  it('rejects a session NFT output at another address', () => {
    const cbor = transactionCbor({
      sessionOutput: true,
      sessionOutputAddress: otherAddress,
    });

    expect(() => assertSubmitOnlyTendermintSessionTx(cbor, CML, eligibilityConfig)).toThrow(
      'configured session address',
    );
  });

  it('rejects unrelated minting in a staged transaction', () => {
    const cbor = transactionCbor({ sessionOutput: true, otherMint: true });

    expect(() => assertSubmitOnlyTendermintSessionTx(cbor, CML, eligibilityConfig)).toThrow(
      'must not mint or burn assets',
    );
  });
});
