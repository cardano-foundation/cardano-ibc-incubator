import * as Lucid from '@lucid-evolution/lucid';
import { ClientState, ConsensusState } from '@cardano-ibc/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import { MsgUpgradeClient, MsgUpgradeClientResponse } from '@cardano-ibc/proto-types/build/ibc/core/client/v1/tx';
import { MerkleProof } from '@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment';
import { TendermintClientService } from '../tendermint-client.service';
import { initializeClientState, normalizeClientStateFromDatum } from '../../shared/helpers/client-state';
import { ClientDatum, decodeClientDatum, encodeClientDatum } from '../../shared/types/client-datum';
import { decodeSpendClientRedeemer, encodeSpendClientRedeemer } from '../../shared/types/client-redeemer';
import { decodeSpendMultitxClientRedeemer } from '../../shared/types/tendermint-update-session';

function context(staged = false) {
  const oldProto = ClientState.fromPartial({
    chain_id: 'chain-0',
    trust_level: { numerator: 1n, denominator: 3n },
    trusting_period: { seconds: 10n, nanos: 123 },
    unbonding_period: { seconds: 20n },
    max_clock_drift: { seconds: 1n },
    latest_height: { revision_number: 0n, revision_height: 100n },
    upgrade_path: ['upgrade', 'upgradedIBCState'],
  });
  const old = initializeClientState(oldProto);
  const before: ClientDatum = {
    token: { policyId: '11'.repeat(28), name: '22' },
    history_root: '00'.repeat(32),
    state: {
      clientState: old,
      consensusStates: new Map([
        [
          old.latestHeight,
          { timestamp: 100_000_000_123n, next_validators_hash: 'aa'.repeat(32), root: { hash: 'bb'.repeat(32) } },
        ],
      ]),
      processedTimes: new Map([[old.latestHeight, 100_000_000_123n]]),
      processedHeights: new Map([[old.latestHeight, 1n]]),
    },
  };
  const proposed = ClientState.fromPartial({
    ...oldProto,
    chain_id: 'chain-1',
    latest_height: { revision_number: 1n, revision_height: 1n },
    trusting_period: { seconds: 999n },
    max_clock_drift: { seconds: 999n },
  });
  const request = MsgUpgradeClient.fromPartial({
    client_id: '07-tendermint-0',
    signer: 'addr_test1relayer',
    client_state: { type_url: ClientState.typeUrl, value: ClientState.encode(proposed).finish() },
    consensus_state: {
      type_url: ConsensusState.typeUrl,
      value: ConsensusState.encode(
        ConsensusState.fromPartial({
          timestamp: { seconds: 100n, nanos: 123 },
          next_validators_hash: Buffer.from('aa'.repeat(32), 'hex'),
        }),
      ).finish(),
    },
    proof_upgrade_client: MerkleProof.encode({
      proofs: [{ exist: { key: new Uint8Array([1]), value: new Uint8Array([2]), path: [] } }],
    }).finish(),
    proof_upgrade_consensus_state: MerkleProof.encode({
      proofs: [{ exist: { key: new Uint8Array([3]), value: new Uint8Array([4]), path: [] } }],
    }).finish(),
  });
  const host = { state: { version: 1n, ibc_state_root: 'bb'.repeat(32) } };
  const lucid: any = {
    LucidImporter: Lucid,
    hasStagedTendermintClient: () => staged,
    getClientTokenUnit: () => 'client-token',
    findUtxoByUnit: async () => ({ datum: 'client' }),
    findUtxoAtHostStateNFT: async () => ({ datum: 'host' }),
    decodeDatum: async (_: string, type: string) => (type === 'client' ? before : host),
    prepareConsensusHistoryUpdate: jest
      .fn()
      .mockResolvedValue({ newRoot: 'cc'.repeat(32), siblings: ['00'.repeat(32)] }),
    encode: jest.fn(async (value, type) =>
      type === 'client'
        ? encodeClientDatum(value, Lucid)
        : type === 'spendClientRedeemer'
          ? encodeSpendClientRedeemer(value, Lucid)
          : '00',
    ),
    createUnsignedUpgradeClientTransaction: jest.fn().mockReturnValue({}),
  };
  const service: any = Object.create(TendermintClientService.prototype);
  Object.assign(service, {
    lucidService: lucid,
    refreshWalletContext: jest.fn(),
    ensureTreeAligned: jest.fn(),
    computeTxValidityWindow: async () => ({ validFromTime: 100000, validToTime: 101000 }),
    ibcTreeStore: {
      computeRootWithUpdateClientUpdate: jest
        .fn()
        .mockReturnValue({
          newRoot: 'dd'.repeat(32),
          clientStateSiblings: [],
          consensusStateSiblings: [],
          commit: jest.fn(),
        }),
    },
    txOperationRunnerService: { run: jest.fn().mockResolvedValue({ unsignedTxBytes: new Uint8Array([1, 2]) }) },
  });
  return { service, lucid, before, request, oldProto };
}

describe('proof-backed Tendermint client upgrade', () => {
  it.each([false, true])('binds both proofs and archives the old tip with staged=%s', async (staged) => {
    const { service, lucid, before, request } = context(staged);
    const response = await service.upgradeClient(request);
    expect(MsgUpgradeClientResponse.decode(MsgUpgradeClientResponse.encode(response).finish())).toEqual(response);
    const args = lucid.createUnsignedUpgradeClientTransaction.mock.calls[0];
    expect(staged ? decodeSpendMultitxClientRedeemer(args[3], Lucid) : decodeSpendClientRedeemer(args[3], Lucid)).toBe(
      'UpgradeClient',
    );
    const after = await decodeClientDatum(args[5], Lucid);
    expect(after.token).toEqual(before.token);
    expect(after.history_root).toBe('cc'.repeat(32));
    expect(after.state.clientState.latestHeight).toEqual({ revisionNumber: 1n, revisionHeight: 1n });
    expect(after.state.clientState.trustingPeriod).toBe(before.state.clientState.trustingPeriod);
    expect(after.state.clientState.maxClockDrift).toBe(before.state.clientState.maxClockDrift);
    expect([...after.state.consensusStates.values()][0].root.hash).toBe(Buffer.from('sentinel_root').toString('hex'));
    expect(service.ibcTreeStore.computeRootWithUpdateClientUpdate.mock.calls[0][4].height).toBe('1-1');
    const envelope = Lucid.Data.from(args[9]) as Lucid.Constr<Lucid.Data>;
    const proof = envelope.fields[0] as Lucid.Constr<Lucid.Data>;
    expect(proof.index).toBe(5);
    expect(proof.fields[0]).toEqual(Lucid.Data.from(await encodeClientDatum(before, Lucid)));
    expect(proof.fields[1]).toEqual(Lucid.Data.from(args[5]));
    expect(lucid.prepareConsensusHistoryUpdate).toHaveBeenCalledTimes(1);
  });

  it.each(['expired', 'frozen', 'disabled', 'missing-proof'])(
    'rejects %s before building a transaction',
    async (kind) => {
      const { service, before, request, lucid } = context();
      if (kind === 'expired') before.state.clientState.trustingPeriod = 1n;
      if (kind === 'frozen') before.state.clientState.frozenHeight.revisionHeight = 1n;
      if (kind === 'disabled') before.state.clientState.upgradePath = [];
      if (kind === 'missing-proof') request.proof_upgrade_client = new Uint8Array();
      await expect(service.upgradeClient(request)).rejects.toThrow();
      expect(lucid.createUnsignedUpgradeClientTransaction).not.toHaveBeenCalled();
    },
  );

  it('round-trips upgrade paths and duration nanoseconds', () => {
    const { before, oldProto } = context();
    const returned = normalizeClientStateFromDatum(before.state.clientState);
    expect(returned.upgrade_path).toEqual(oldProto.upgrade_path);
    expect(returned.trusting_period).toEqual(oldProto.trusting_period);
  });
});
