import crypto from 'crypto';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Lucid from '@lucid-evolution/lucid';

import { QueryService } from '../services/query.service';
import { HistoryService } from '../services/history.service';
import { KupoService } from '../../shared/modules/kupo/kupo.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { DenomTraceService } from '../services/denom-trace.service';
import type { ClientDatum } from '../../shared/types/client-datum';
import type { SessionDatum, TargetEntry, UpdatePlan } from '../../shared/types/tendermint-update-session';
import {
  encodeSessionDatum,
  encodeSpendMultitxClientRedeemer,
  encodeSpendSessionRedeemer,
} from '../../shared/types/tendermint-update-session';
import { encodeMintClientRedeemer } from '../../shared/types/client-redeemer';
import { hashTendermintValidatorSet } from '../../tx/update-client-staged-payload';

const SESSION_POLICY = '81'.repeat(28);
const SESSION_NAME = '82'.repeat(32);
const SESSION_ADDRESS = 'addr_test1_session';
const CLIENT_TOKEN = { policyId: '83'.repeat(28), name: '84' };
const CLIENT_ADDRESS = 'addr_test1_client';
const VALIDATOR_PUBLIC_KEY = '86'.repeat(32);
const CLIENT_INPUT_TX_HASH = '22'.repeat(32);
const SESSION_INPUT_TX_HASH = '44'.repeat(32);
const VALIDATOR = {
  address: crypto.createHash('sha256').update(Buffer.from(VALIDATOR_PUBLIC_KEY, 'hex')).digest('hex').slice(0, 40),
  pubkey: VALIDATOR_PUBLIC_KEY,
  votingPower: 10n,
  proposerPriority: 0n,
};

function sessionPlan(): UpdatePlan {
  const validatorRoot = hashTendermintValidatorSet([VALIDATOR]);
  return {
    clientToken: CLIENT_TOKEN,
    trustedHeight: { revisionNumber: 0n, revisionHeight: 8n },
    trustedConsensusState: {
      timestamp: 1n,
      next_validators_hash: validatorRoot,
      root: { hash: '87'.repeat(32) },
    },
    trustLevel: { numerator: 1n, denominator: 3n },
    trustingPeriod: 10n,
    maxClockDrift: 2n,
    header: {
      version: { block: 11n, app: 0n },
      chainId: Buffer.from('chain-0').toString('hex'),
      height: 9n,
      time: 3n,
      lastBlockId: { hash: '88'.repeat(32), partSetHeader: { total: 1n, hash: '89'.repeat(32) } },
      lastCommitHash: '8a'.repeat(32),
      dataHash: '8b'.repeat(32),
      validatorsHash: validatorRoot,
      nextValidatorsHash: '8c'.repeat(32),
      consensusHash: '8d'.repeat(32),
      appHash: '8e'.repeat(32),
      lastResultsHash: '8f'.repeat(32),
      evidenceHash: '90'.repeat(32),
      proposerAddress: VALIDATOR.address,
    },
    commit: {
      height: 9n,
      round: 0n,
      blockId: { hash: '91'.repeat(32), partSetHeader: { total: 1n, hash: '92'.repeat(32) } },
    },
    targetValidatorCount: 1n,
    trustedValidatorCount: 0n,
  };
}

function transactionBodyCbor(inputs: Array<{ txHash: string; outputIndex?: bigint }>): string {
  const inputList = Lucid.CML.TransactionInputList.new();
  inputs.forEach(({ txHash, outputIndex = 0n }) => {
    inputList.add(Lucid.CML.TransactionInput.new(Lucid.CML.TransactionHash.from_hex(txHash), outputIndex));
  });
  return Lucid.CML.TransactionBody.new(inputList, Lucid.CML.TransactionOutputList.new(), 0n).to_cbor_hex();
}

async function stagedHistoryFixture(
  options: { bundledFinalLookalike?: boolean; bundledAdvanceLookalike?: boolean } = {},
) {
  const plan = sessionPlan();
  const sessionToken = { policyId: SESSION_POLICY, name: SESSION_NAME };
  const collectingSession: SessionDatum = {
    sessionToken,
    owner: '93'.repeat(28),
    plan,
    phase: {
      AdjacentTarget: {
        targetAccumulator: { count: 0n, peaks: [] },
        targetTotalPower: 0n,
        targetSignedPower: 0n,
        lastTarget: null,
      },
    },
  };
  const completeSession: SessionDatum = {
    sessionToken,
    owner: collectingSession.owner,
    plan,
    phase: {
      Complete: {
        targetRoot: plan.header.validatorsHash,
        targetTotalPower: 10n,
        targetSignedPower: 10n,
        trustedRoot: null,
        trustedTotalPower: 0n,
        trustedSignedPower: 0n,
      },
    },
  };
  const targetEntry: TargetEntry = {
    targetValidator: VALIDATOR,
    commitSig: {
      block_id_flag: 2n,
      validator_address: VALIDATOR.address,
      timestamp: 4n,
      signature: '94'.repeat(64),
    },
    trustedMembership: null,
  };
  const finalRedeemers = [
    ...(options.bundledFinalLookalike
      ? [
          {
            type: 'mint',
            index: 0n,
            data: await encodeMintClientRedeemer('MintClient', Lucid),
          },
          {
            type: 'spend',
            index: 0n,
            data: encodeSpendMultitxClientRedeemer(
              { FinalizeUpdate: { sessionToken: { policyId: SESSION_POLICY, name: 'ff'.repeat(32) } } },
              Lucid,
            ),
          },
        ]
      : []),
    {
      type: 'spend',
      index: 1n,
      data: encodeSpendMultitxClientRedeemer({ FinalizeUpdate: { sessionToken } }, Lucid),
    },
  ];
  const advanceRedeemers = [
    ...(options.bundledAdvanceLookalike
      ? [
          {
            type: 'spend',
            index: 0,
            data: encodeSpendSessionRedeemer({ VerifyTarget: { entries: [targetEntry] } }, Lucid),
          },
        ]
      : []),
    {
      type: 'spend',
      index: 1,
      data: encodeSpendSessionRedeemer({ VerifyTarget: { entries: [targetEntry] } }, Lucid),
    },
  ];
  const clientInput = {
    txHash: CLIENT_INPUT_TX_HASH,
    outputIndex: 0,
    address: CLIENT_ADDRESS,
    assetsPolicy: CLIENT_TOKEN.policyId,
    assetsName: CLIENT_TOKEN.name,
    blockNo: 10,
  };
  const sessionOutputs = [
    {
      txHash: SESSION_INPUT_TX_HASH,
      outputIndex: 0,
      address: SESSION_ADDRESS,
      assetsPolicy: SESSION_POLICY,
      assetsName: SESSION_NAME,
      datum: encodeSessionDatum(collectingSession, Lucid),
      blockNo: 18,
    },
    {
      txHash: 'advance-tx',
      outputIndex: 0,
      address: SESSION_ADDRESS,
      assetsPolicy: SESSION_POLICY,
      assetsName: SESSION_NAME,
      datum: encodeSessionDatum(completeSession, Lucid),
      blockNo: 19,
    },
  ];
  const historyService = {
    findUtxosByPolicyIdAndPrefixTokenName: jest.fn(async (policyId: string, tokenName: string) => {
      if (policyId === CLIENT_TOKEN.policyId && tokenName === CLIENT_TOKEN.name) return [clientInput];
      if (policyId === SESSION_POLICY && tokenName === SESSION_NAME) return sessionOutputs;
      return [];
    }),
  } as unknown as HistoryService;
  const evidenceByTxHash = new Map([
    [
      'final-tx',
      {
        // Deliberately supply the client input before the lower-hash lookalike input.
        txBodyCborHex: transactionBodyCbor([{ txHash: CLIENT_INPUT_TX_HASH }, { txHash: '11'.repeat(32) }]),
        redeemers: finalRedeemers.map((redeemer) => ({ ...redeemer, index: Number(redeemer.index) })),
      },
    ],
    [
      'advance-tx',
      {
        // Deliberately supply the session input before the lower-hash lookalike input.
        txBodyCborHex: transactionBodyCbor([{ txHash: SESSION_INPUT_TX_HASH }, { txHash: '33'.repeat(32) }]),
        redeemers: advanceRedeemers,
      },
    ],
    [
      SESSION_INPUT_TX_HASH,
      {
        txBodyCborHex: transactionBodyCbor([{ txHash: '55'.repeat(32) }]),
        redeemers: [],
      },
    ],
  ]);
  const miniProtocalsService = {
    fetchTransactionEvidence: jest.fn(async (txHash: string) => {
      const evidence = evidenceByTxHash.get(txHash);
      if (!evidence) throw new Error(`Missing test evidence for ${txHash}`);
      return evidence;
    }),
  } as unknown as MiniProtocalsService;
  const configService = {
    get: jest.fn().mockReturnValue({
      validators: {
        mintClientStt: { scriptHash: CLIENT_TOKEN.policyId },
        spendClient: { address: CLIENT_ADDRESS },
        mintTendermintUpdateSession: { scriptHash: SESSION_POLICY },
        spendTendermintUpdateSession: { address: SESSION_ADDRESS },
      },
    }),
  } as unknown as ConfigService;
  const service = new QueryService(
    { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Logger,
    configService,
    { LucidImporter: Lucid } as unknown as LucidService,
    {} as KupoService,
    historyService,
    miniProtocalsService,
    {} as MithrilService,
    {} as DenomTraceService,
    {} as any,
  );

  return {
    service,
    historyService,
    miniProtocalsService,
    finalRedeemers,
    plan,
    targetEntry,
  };
}

describe('QueryService staged client event history', () => {
  it('recovers a full header from the finalized session after process memory is gone', async () => {
    const { service, historyService, miniProtocalsService, finalRedeemers, plan, targetEntry } =
      await stagedHistoryFixture();
    const clientDatum = { token: CLIENT_TOKEN } as ClientDatum;

    const header = await (service as any).recoverStagedTendermintHeader(
      {
        txHash: 'final-tx',
        blockNo: 20,
        address: CLIENT_ADDRESS,
        assetsPolicy: CLIENT_TOKEN.policyId,
        assetsName: CLIENT_TOKEN.name,
      } as any,
      clientDatum,
      finalRedeemers,
    );

    expect(historyService.findUtxosByPolicyIdAndPrefixTokenName).toHaveBeenCalledWith(
      CLIENT_TOKEN.policyId,
      CLIENT_TOKEN.name,
    );
    expect(historyService.findUtxosByPolicyIdAndPrefixTokenName).toHaveBeenCalledWith(SESSION_POLICY, SESSION_NAME);
    expect(miniProtocalsService.fetchTransactionEvidence).toHaveBeenCalledWith('advance-tx');
    expect(header.signedHeader.header).toEqual(plan.header);
    expect(header.signedHeader.commit.signatures).toEqual([targetEntry.commitSig]);
    expect(header.validatorSet.validators).toEqual([VALIDATOR]);
    expect(header.trustedValidators.validators).toEqual([VALIDATOR]);
  });

  it('ignores a bundled FinalizeUpdate redeemer that is not attached to the canonical client input', async () => {
    const { service, historyService, finalRedeemers } = await stagedHistoryFixture({ bundledFinalLookalike: true });

    const stagedHeader = await (service as any).recoverStagedTendermintHeader(
      {
        txHash: 'final-tx',
        blockNo: 20,
        address: CLIENT_ADDRESS,
        assetsPolicy: CLIENT_TOKEN.policyId,
        assetsName: CLIENT_TOKEN.name,
      },
      { token: CLIENT_TOKEN } as ClientDatum,
      finalRedeemers,
    );

    expect(stagedHeader).toMatchObject({ signedHeader: { header: { height: 9n } } });
    expect((service as any).clientEventType(finalRedeemers, null)).toBe('create_client');
    expect((service as any).clientEventType(finalRedeemers, stagedHeader)).toBe('update_client');
    expect(historyService.findUtxosByPolicyIdAndPrefixTokenName).not.toHaveBeenCalledWith(
      SESSION_POLICY,
      'ff'.repeat(32),
    );
  });

  it('ignores a bundled VerifyTarget redeemer that is not attached to the exact session NFT input', async () => {
    const { service, finalRedeemers } = await stagedHistoryFixture({ bundledAdvanceLookalike: true });

    const header = await (service as any).recoverStagedTendermintHeader(
      {
        txHash: 'final-tx',
        blockNo: 20,
        address: CLIENT_ADDRESS,
        assetsPolicy: CLIENT_TOKEN.policyId,
        assetsName: CLIENT_TOKEN.name,
      },
      { token: CLIENT_TOKEN } as ClientDatum,
      finalRedeemers,
    );

    expect(header.validatorSet.validators).toEqual([VALIDATOR]);
    expect(header.signedHeader.commit.signatures).toHaveLength(1);
  });

  it('exposes exact-tx client events for confirmed submission recovery', async () => {
    const matchingUtxo = { txHash: 'final-tx' };
    const historyService = {
      findTxByHash: jest.fn().mockResolvedValue({ hash: 'final-tx', height: 20 }),
      findClientUtxosByBlockNo: jest.fn().mockResolvedValue([matchingUtxo, { txHash: 'other-tx' }]),
    } as unknown as HistoryService;
    const service = new QueryService(
      { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Logger,
      {} as ConfigService,
      {} as LucidService,
      {} as KupoService,
      historyService,
      {} as MiniProtocalsService,
      {} as MithrilService,
      {} as DenomTraceService,
      {} as any,
    );
    const parseEventClient = jest.spyOn(service as any, '_parseEventClient').mockResolvedValue([
      {
        events: [
          {
            type: 'update_client',
            event_attribute: [
              { key: 'client_id', value: '07-tendermint-0' },
              { key: 'consensus_height', value: '0-9' },
            ],
          },
        ],
      },
    ]);

    await expect(service.queryClientEventsByTxHash('FINAL-TX')).resolves.toEqual({
      tx_hash: 'final-tx',
      height: '20',
      indexed: true,
      events: [
        {
          type: 'update_client',
          attributes: [
            { key: 'client_id', value: '07-tendermint-0' },
            { key: 'consensus_height', value: '0-9' },
          ],
        },
      ],
    });
    expect(historyService.findTxByHash).toHaveBeenCalledWith('final-tx');
    expect(parseEventClient).toHaveBeenCalledWith([matchingUtxo]);
  });
});
