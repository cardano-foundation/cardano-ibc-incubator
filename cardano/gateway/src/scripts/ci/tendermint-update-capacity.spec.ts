import * as Lucid from '@lucid-evolution/lucid';
import { decodeClientDatum } from '@shared/types/client-datum';
import { decodeMintClientRedeemer } from '@shared/types/client-redeemer';
import { consensusStateTokenName, decodeConsensusStateDatum } from '@shared/types/consensus-state-datum';
import { analyzeCapacityScenario, loadNormalizedCapacityFixture } from './tendermint-update-capacity';

describe('Tendermint update capacity archive model', () => {
  it('counts the singleton tip, immutable output, NFT mint, third script and reference', async () => {
    const fixture = loadNormalizedCapacityFixture();
    const scenario = fixture.scenarios.adjacent_all_signed;
    const artifact = await analyzeCapacityScenario('adjacent_all_signed', scenario, {
      hostState: { mem: 1n, steps: 2n }, spendClient: { mem: 3n, steps: 4n }, archiveMint: { mem: 5n, steps: 6n },
    }, 'aiken-unit-tests');
    const { report, encoded } = artifact;
    expect(report).toMatchObject({ inputConsensusStates: 1, outputConsensusStates: 1, archivedConsensusStates: 1, removedConsensusStates: 0 });
    expect(report.shape).toEqual({ regularInputs: 3, scriptInputs: 2, collateralInputs: 1, referenceInputs: 3, inlineDatumOutputs: 3, spendRedeemers: 2, mintRedeemers: 1, mintedAssets: 1, vkeyWitnesses: 1 });
    expect(report.scriptExUnits.total).toEqual({ mem: '9', steps: '12' });
    const client = await decodeClientDatum(encoded.updatedClientDatum, Lucid);
    expect(client.state.consensusStates.size).toBe(1);
    expect(client.state.processedTimes.size).toBe(1);
    expect(client.state.processedHeights.size).toBe(1);
    const archive = decodeConsensusStateDatum(encoded.archiveDatum, Lucid);
    expect(archive.height.revisionHeight).toBe(BigInt(scenario.header.trusted_height.revision_height));
    expect(archive.clientToken).toEqual(client.token);
    expect(encoded.archiveTokenName).toBe(consensusStateTokenName(client.token, archive.height, Lucid));
    expect(decodeMintClientRedeemer(encoded.archiveMintRedeemer, Lucid)).toEqual({ ArchiveConsensusState: { client_token: client.token } });
    const body = Lucid.CML.Transaction.from_cbor_hex(artifact.signedCbor).body();
    expect(body.mint()!.get(Lucid.CML.ScriptHash.from_hex(client.token.policyId), Lucid.CML.AssetName.from_raw_bytes(Buffer.from(encoded.archiveTokenName, 'hex')))).toBe(1n);
    expect(report.payloads.totalBytes).toBe(Object.entries(report.payloads).filter(([key]) => key !== 'totalBytes').reduce((total, [, size]) => total + size, 0));
    // Real large-validator fixtures remain diagnostic, not an accidental gate.
    expect(report.classification).toBe('structural-signed-lower-bound');
    expect(report.ledgerEvaluated).toBe(false);
  });
});
