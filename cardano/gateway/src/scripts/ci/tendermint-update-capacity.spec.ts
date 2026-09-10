import * as Lucid from '@lucid-evolution/lucid';
import { decodeClientDatum } from '@shared/types/client-datum';
import { analyzeCapacityScenario, loadNormalizedCapacityFixture } from './tendermint-update-capacity';

describe('Tendermint update capacity proof-backed model', () => {
  it('counts the singleton tip, history insertion proof and bound support withdrawal', async () => {
    const fixture = loadNormalizedCapacityFixture();
    const scenario = fixture.scenarios.adjacent_all_signed;
    const artifact = await analyzeCapacityScenario('adjacent_all_signed', scenario, {
      hostState: { mem: 1n, steps: 2n }, spendClient: { mem: 3n, steps: 4n }, clientSupport: { mem: 5n, steps: 6n },
    }, 'aiken-unit-tests');
    const { report, encoded } = artifact;
    expect(report).toMatchObject({ inputConsensusStates: 1, outputConsensusStates: 1, committedHistoricalStates: 1, removedConsensusStates: 0 });
    expect(report.shape).toEqual({ regularInputs: 3, scriptInputs: 2, collateralInputs: 1, referenceInputs: 3, inlineDatumOutputs: 2, spendRedeemers: 2, mintRedeemers: 0, withdrawalRedeemers: 1, mintedAssets: 0, vkeyWitnesses: 1 });
    expect(report.scriptExUnits.total).toEqual({ mem: '9', steps: '12' });
    const client = await decodeClientDatum(encoded.updatedClientDatum, Lucid);
    expect(client.state.consensusStates.size).toBe(1);
    expect(client.state.processedTimes.size).toBe(1);
    expect(client.state.processedHeights.size).toBe(1);
    expect(client.history_root).toMatch(/^[0-9a-f]{64}$/);
    expect(client.history_root).not.toBe('00'.repeat(32));
    const support = Lucid.Data.from(encoded.clientSupportRedeemer) as Lucid.Constr<Lucid.Data>;
    expect(support.index).toBe(1);
    expect(support.fields).toEqual([new Lucid.Constr(0, [client.token.policyId, client.token.name])]);
    const spend = Lucid.Data.from(encoded.spendClientRedeemer) as Lucid.Constr<Lucid.Data>;
    expect(spend.fields[1]).toEqual([]);
    expect(spend.fields[2]).toEqual(Array(64).fill('00'.repeat(32)));
    const body = Lucid.CML.Transaction.from_cbor_hex(artifact.signedCbor).body();
    expect(body.mint()).toBeUndefined();
    expect(body.withdrawals()!.len()).toBe(1);
    expect(report.payloads.totalBytes).toBe(Object.entries(report.payloads).filter(([key]) => key !== 'totalBytes').reduce((total, [, size]) => total + size, 0));
    // Real large-validator fixtures remain diagnostic, not an accidental gate.
    expect(report.classification).toBe('structural-signed-lower-bound');
    expect(report.ledgerEvaluated).toBe(false);
  });
});
