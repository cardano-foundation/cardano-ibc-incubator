import { type Script, type UTxO, validatorToScriptHash } from '@lucid-evolution/lucid';

import { requireMatchingReferenceScriptUtxo } from './lucid.service';

const expectedScript: Script = { type: 'PlutusV3', script: '590100' };
const otherScript: Script = { type: 'PlutusV3', script: '4e4d01000033222220051200120011' };

function referenceUtxo(scriptRef?: Script): UTxO {
  return {
    txHash: 'aa'.repeat(32),
    outputIndex: 0,
    address: 'addr_test1_reference_script',
    assets: { lovelace: 2_000_000n },
    scriptRef,
  };
}

describe('LucidService reference-script verification', () => {
  it('accepts a reference output whose script matches the configured hash', () => {
    const utxo = referenceUtxo(expectedScript);

    expect(
      requireMatchingReferenceScriptUtxo('mintLifecycleReclamationMarker', utxo, validatorToScriptHash(expectedScript)),
    ).toBe(utxo);
  });

  it('rejects an existing plain output', () => {
    expect(() =>
      requireMatchingReferenceScriptUtxo(
        'mintLifecycleReclamationMarker',
        referenceUtxo(),
        validatorToScriptHash(expectedScript),
      ),
    ).toThrow(/does not contain a reference script/);
  });

  it('rejects an existing output whose reference script has the wrong hash', () => {
    expect(() =>
      requireMatchingReferenceScriptUtxo(
        'mintLifecycleReclamationMarker',
        referenceUtxo(otherScript),
        validatorToScriptHash(expectedScript),
      ),
    ).toThrow(new RegExp(`has script hash ${validatorToScriptHash(otherScript)}, expected`));
  });
});
