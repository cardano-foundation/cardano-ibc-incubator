import * as Lucid from '@lucid-evolution/lucid';

import { decodeTendermintProofRedeemer } from '@shared/types/tendermint-proof-redeemer';

import {
  analyzeCapacityScenario,
  analyzeProofCapacityScenario,
  loadNormalizedCapacityFixture,
  resizeCapacityScenario,
  STRUCTURAL_PLACEHOLDER_EX_UNITS,
  type ProofStructuralExUnits,
  type StructuralExUnits,
} from './tendermint-update-capacity';

const DIRECT_EX_UNITS: StructuralExUnits = {
  hostState: { mem: 13_782_552n, steps: 4_336_798_818n },
  spendClient: { mem: 43_629_795n, steps: 14_969_997_249n },
};

const SP1_EX_UNITS: ProofStructuralExUnits = {
  hostState: DIRECT_EX_UNITS.hostState,
  spendClient: { mem: 333_531n, steps: 109_121_614n },
  tendermintProof: { mem: 1_196_375n, steps: 3_791_099_229n },
};

describe('Tendermint UpdateClient capacity comparison', () => {
  const scenario = loadNormalizedCapacityFixture().scenarios.adjacent_all_signed;

  it('compares the direct and SP1 paths at the same one-to-two-state boundary', async () => {
    const direct = await analyzeCapacityScenario('adjacent_all_signed', scenario, DIRECT_EX_UNITS, 'aiken-unit-tests');
    const sp1 = await analyzeProofCapacityScenario('adjacent_all_signed', scenario, SP1_EX_UNITS, 'aiken-unit-tests');

    expect(direct.report).toMatchObject({
      mode: 'direct',
      validatorCount: 45,
      trustedValidatorCount: 45,
      inputConsensusStates: 1,
      outputConsensusStates: 2,
      signedBytes: 16_791,
      shape: { referenceInputs: 2, spendRedeemers: 2, rewardRedeemers: 0, withdrawals: 0 },
    });
    expect(sp1.report).toMatchObject({
      mode: 'sp1',
      validatorCount: 45,
      trustedValidatorCount: 45,
      inputConsensusStates: 1,
      outputConsensusStates: 2,
      signedBytes: 6_041,
      payloads: { wrappedProofBytes: 288 },
      shape: { referenceInputs: 3, spendRedeemers: 2, rewardRedeemers: 1, withdrawals: 1 },
    });
    expect(sp1.report.scriptExUnits.total).toEqual({ mem: '15312458', steps: '8237019661' });

    const transaction = Lucid.CML.Transaction.from_cbor_hex(sp1.signedCbor);
    const redeemerMap = transaction.witness_set().redeemers()?.as_map_redeemer_key_to_redeemer_val();
    expect(redeemerMap).toBeDefined();
    const keys = redeemerMap!.keys();
    const purposes = Array.from({ length: keys.len() }, (_, index) => {
      const key = keys.get(index);
      return [key.tag(), key.index()] as const;
    });
    expect(purposes).toEqual([
      [Lucid.CML.RedeemerTag.Spend, 0n],
      [Lucid.CML.RedeemerTag.Spend, 1n],
      [Lucid.CML.RedeemerTag.Reward, 0n],
    ]);

    const rewardKey = Array.from({ length: keys.len() }, (_, index) => keys.get(index)).find(
      (key) => key.tag() === Lucid.CML.RedeemerTag.Reward,
    );
    expect(rewardKey).toBeDefined();
    const proofRedeemer = decodeTendermintProofRedeemer(redeemerMap!.get(rewardKey!)!.data().to_cbor_hex(), Lucid);
    expect(proofRedeemer).toMatchObject({
      Update: {
        client_input_ref: { transaction_id: '22'.repeat(32), output_index: 0n },
        proof: expect.stringMatching(/^[0-9a-f]{576}$/),
      },
    });

    const withdrawals = transaction.body().withdrawals();
    expect(withdrawals?.len()).toBe(1);
    const rewardAccount = withdrawals!.keys().get(0);
    expect(rewardAccount.payment().as_script()?.to_hex()).toBe('e7'.repeat(28));
    expect(withdrawals!.get(rewardAccount)).toBe(0n);
  });

  it('produces deterministic canonical transactions', async () => {
    const first = await analyzeProofCapacityScenario('adjacent_all_signed', scenario, SP1_EX_UNITS, 'aiken-unit-tests');
    const second = await analyzeProofCapacityScenario(
      'adjacent_all_signed',
      scenario,
      SP1_EX_UNITS,
      'aiken-unit-tests',
    );

    expect(first.unsignedCbor).toBe(second.unsignedCbor);
    expect(first.signedCbor).toBe(second.signedCbor);
    expect(first.encoded.tendermintProofRedeemer).toBe(second.encoded.tendermintProofRedeemer);
  });

  it('shows monotonic direct-path encoding growth for fixed-width validator shapes', async () => {
    const counts = [4, 16, 32, 45, 64, 100, 200];
    const sizes = await Promise.all(
      counts.map(async (validatorCount) => {
        const resized = resizeCapacityScenario(scenario, validatorCount);
        return (
          await analyzeCapacityScenario(
            `encoding_shape_${validatorCount}`,
            resized,
            STRUCTURAL_PLACEHOLDER_EX_UNITS,
            'structural-placeholder',
          )
        ).report.signedBytes;
      }),
    );

    expect(sizes.every((size, index) => index === 0 || size > sizes[index - 1])).toBe(true);
  });
});
