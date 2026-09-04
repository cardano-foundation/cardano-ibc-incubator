import * as Lucid from '@lucid-evolution/lucid';

import {
  decodeMintSessionRedeemer,
  decodeSessionDatum,
  decodeSpendMultitxClientRedeemer,
  decodeSpendSessionRedeemer,
  decodeUpdatePlan,
  encodeMintSessionRedeemer,
  encodeSessionDatum,
  encodeSpendMultitxClientRedeemer,
  encodeSpendSessionRedeemer,
  encodeUpdatePlan,
  MintSessionRedeemer,
  SessionDatum,
  SessionPhase,
  SpendMultitxClientRedeemer,
  SpendSessionRedeemer,
  sameTendermintUpdatePlan,
  TargetEntry,
  tendermintUpdatePlanHash,
  tendermintUpdateSessionTokenName,
  UpdatePlan,
} from './tendermint-update-session';

const BLOCK_ID = {
  hash: '17',
  partSetHeader: { total: 18n, hash: '19' },
} as const;

const PLAN: UpdatePlan = {
  clientToken: { policyId: '01', name: '02' },
  trustedHeight: { revisionNumber: 3n, revisionHeight: 4n },
  trustedConsensusState: {
    timestamp: 5n,
    next_validators_hash: '06',
    root: { hash: '07' },
  },
  trustLevel: { numerator: 8n, denominator: 9n },
  trustingPeriod: 10n,
  maxClockDrift: 11n,
  header: {
    version: { block: 12n, app: 13n },
    chainId: '14',
    height: 15n,
    time: 16n,
    lastBlockId: BLOCK_ID,
    lastCommitHash: '1a',
    dataHash: '1b',
    validatorsHash: '1c',
    nextValidatorsHash: '1d',
    consensusHash: '1e',
    appHash: '1f',
    lastResultsHash: '20',
    evidenceHash: '21',
    proposerAddress: '22',
  },
  commit: {
    height: 23n,
    round: 24n,
    blockId: {
      hash: '25',
      partSetHeader: { total: 26n, hash: '27' },
    },
  },
  targetValidatorCount: 28n,
  trustedValidatorCount: 29n,
};

const ACCUMULATOR = {
  count: 1n,
  peaks: [{ size: 1n, root: '31' }],
} as const;

const ORDER_KEY = {
  votingPower: 30n,
  address: '32',
} as const;

const TARGET_ENTRY: TargetEntry = {
  targetValidator: {
    address: '41',
    pubkey: '42',
    votingPower: 43n,
    proposerPriority: 44n,
  },
  commitSig: {
    block_id_flag: 2n,
    validator_address: '41',
    timestamp: 45n,
    signature: '43',
  },
  trustedMembership: {
    index: 0n,
    trustedValidator: {
      address: '51',
      pubkey: '52',
      votingPower: 53n,
      proposerPriority: 54n,
    },
    auditPath: ['55', '56'],
  },
};

function rawConstructor(cbor: string): any {
  return Lucid.Data.from(cbor) as any;
}

describe('Tendermint update-session Lucid codecs', () => {
  it('pins UpdatePlan CBOR and round-trips every field in Aiken order', () => {
    const encoded = encodeUpdatePlan(PLAN, Lucid);

    expect(encoded).toBe(
      'd8799fd8799f41014102ffd8799f0304ffd8799f054106d8799f4107ffffd8799f0809ff0a0bd8799fd8799f0c0dff41140f10d8799f4117d8799f124119ffff411a411b411c411d411e411f412041214122ffd8799f171818d8799f4125d8799f181a4127ffffff181c181dff',
    );
    expect(decodeUpdatePlan(encoded, Lucid)).toEqual(PLAN);

    const raw = rawConstructor(encoded);
    expect(raw.index).toBe(0);
    expect(raw.fields).toHaveLength(10);
    expect(raw.fields[0].fields).toEqual(['01', '02']);
    expect(raw.fields[1].fields).toEqual([3n, 4n]);
    expect(raw.fields[8]).toBe(28n);
    expect(raw.fields[9]).toBe(29n);
  });

  it('matches the pinned Aiken plan-hash and session-token-name vectors', () => {
    const seed = { transactionId: '91', outputIndex: 2n };

    // Independently evaluated from the exported Aiken `session.plan_hash` and
    // `session.session_token_name` UPLC programs with this PLAN and seed.
    expect(tendermintUpdatePlanHash(PLAN, Lucid)).toBe(
      '3f6916cc37bb1320545493e5a55e46f7dd915085fe77859cef7c37e42922d405',
    );
    expect(tendermintUpdateSessionTokenName(seed, PLAN, Lucid)).toBe(
      '2c868d761c5aac27a22e841f285a6e386eadc89ece0d37df84836ac8cb6daae9',
    );
    expect(tendermintUpdateSessionTokenName({ ...seed, outputIndex: 3n }, PLAN, Lucid)).not.toBe(
      tendermintUpdateSessionTokenName(seed, PLAN, Lucid),
    );
  });

  it('compares UpdatePlans by the exact on-chain hash commitment', () => {
    const samePlan = structuredClone(PLAN);
    const changedPlan = { ...structuredClone(PLAN), maxClockDrift: PLAN.maxClockDrift + 1n };

    expect(sameTendermintUpdatePlan(PLAN, samePlan, Lucid)).toBe(true);
    expect(sameTendermintUpdatePlan(PLAN, changedPlan, Lucid)).toBe(false);
  });

  it.each<[number, SessionPhase]>([
    [
      0,
      {
        AdjacentTarget: {
          targetAccumulator: { count: ACCUMULATOR.count, peaks: [...ACCUMULATOR.peaks] },
          targetTotalPower: 2n,
          targetSignedPower: 3n,
          lastTarget: null,
        },
      },
    ],
    [
      1,
      {
        NonAdjacentTrusted: {
          trustedAccumulator: { count: ACCUMULATOR.count, peaks: [...ACCUMULATOR.peaks] },
          trustedTotalPower: 4n,
          lastTrusted: ORDER_KEY,
        },
      },
    ],
    [
      2,
      {
        NonAdjacentTarget: {
          trustedRoot: '61',
          trustedTotalPower: 5n,
          targetAccumulator: { count: ACCUMULATOR.count, peaks: [...ACCUMULATOR.peaks] },
          targetTotalPower: 6n,
          targetSignedPower: 7n,
          trustedSignedPower: 8n,
          usedTrustedIndices: 9n,
          lastTarget: ORDER_KEY,
        },
      },
    ],
    [
      3,
      {
        Complete: {
          targetRoot: '71',
          targetTotalPower: 10n,
          targetSignedPower: 11n,
          trustedRoot: null,
          trustedTotalPower: 12n,
          trustedSignedPower: 13n,
        },
      },
    ],
  ])('round-trips SessionPhase constructor %i without changing its index', (constructorIndex, phase) => {
    const datum: SessionDatum = {
      sessionToken: { policyId: '81', name: '82' },
      owner: '83',
      plan: PLAN,
      phase,
    };
    const encoded = encodeSessionDatum(datum, Lucid);

    expect(decodeSessionDatum(encoded, Lucid)).toEqual(datum);
    const raw = rawConstructor(encoded);
    expect(raw.index).toBe(0);
    expect(raw.fields).toHaveLength(4);
    expect(raw.fields[3].index).toBe(constructorIndex);
    const optionField = [3, 2, 7, 3][constructorIndex];
    const expectedOptionConstructor = constructorIndex === 0 || constructorIndex === 3 ? 1 : 0;
    expect(raw.fields[3].fields[optionField].index).toBe(expectedOptionConstructor);
  });

  it('pins both MintSessionRedeemer constructors', () => {
    const mint: MintSessionRedeemer = {
      MintSession: {
        seed: { transactionId: '91', outputIndex: 2n },
        owner: '92',
        plan: PLAN,
      },
    };
    const burn: MintSessionRedeemer = { BurnSession: { tokenName: 'deadbeef' } };

    const encodedMint = encodeMintSessionRedeemer(mint, Lucid);
    const encodedBurn = encodeMintSessionRedeemer(burn, Lucid);
    const rawMint = rawConstructor(encodedMint);
    expect(rawMint.index).toBe(0);
    expect(rawMint.fields[0].fields).toEqual(['91', 2n]);
    expect(encodedBurn).toBe('d87a8144deadbeef');
    expect(decodeMintSessionRedeemer(encodedMint, Lucid)).toEqual(mint);
    expect(decodeMintSessionRedeemer(encodedBurn, Lucid)).toEqual(burn);
  });

  it('pins all SpendSessionRedeemer constructors and nested membership Options', () => {
    const variants: Array<[SpendSessionRedeemer, number, string?]> = [
      [{ VerifyTrusted: { validators: [TARGET_ENTRY.targetValidator] } }, 0],
      [{ VerifyTarget: { entries: [TARGET_ENTRY, { ...TARGET_ENTRY, trustedMembership: null }] } }, 1],
      ['Finalize', 2, 'd87b80'],
      ['Cancel', 3, 'd87c80'],
    ];

    variants.forEach(([redeemer, expectedIndex, expectedCbor]) => {
      const encoded = encodeSpendSessionRedeemer(redeemer, Lucid);
      if (expectedCbor) expect(encoded).toBe(expectedCbor);
      expect(rawConstructor(encoded).index).toBe(expectedIndex);
      expect(decodeSpendSessionRedeemer(encoded, Lucid)).toEqual(redeemer);
    });

    const targetRaw = rawConstructor(encodeSpendSessionRedeemer(variants[1][0], Lucid));
    const entries = targetRaw.fields[0];
    expect(entries[0].fields[2].index).toBe(0);
    expect(entries[1].fields[2].index).toBe(1);
  });

  it('pins both SpendMultitxClientRedeemer constructors', () => {
    const finalize: SpendMultitxClientRedeemer = {
      FinalizeUpdate: { sessionToken: { policyId: '01', name: '02' } },
    };

    const encodedFinalize = encodeSpendMultitxClientRedeemer(finalize, Lucid);
    const encodedDisabled = encodeSpendMultitxClientRedeemer('DirectUpdateDisabled', Lucid);

    expect(encodedFinalize).toBe('d87981d8798241014102');
    expect(encodedDisabled).toBe('d87a80');
    expect(decodeSpendMultitxClientRedeemer(encodedFinalize, Lucid)).toEqual(finalize);
    expect(decodeSpendMultitxClientRedeemer(encodedDisabled, Lucid)).toBe('DirectUpdateDisabled');
  });
});
