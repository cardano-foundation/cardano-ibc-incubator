import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Lucid from '@lucid-evolution/lucid';

import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';
import * as time from '../../shared/helpers/time';
import { createTestTreeContext } from '../../shared/testing/ibc-tree-test-store';
import {
  ClientDatum,
  decodeClientDatum,
  encodeClientStateValue,
  encodeConsensusStateValue,
} from '../../shared/types/client-datum';
import { initializeHeader } from '../../shared/types/header';
import { HostStateDatum } from '../../shared/types/host-state-datum';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { ClientService } from '../client.service';
import { TxOperationRunnerService } from '../tx-operation-runner.service';
import * as validation from '../helper/client.validate';
import headerMockBuilder from './mock/header';

const validFromMs = 1_700_000_000_000;
const validToMs = validFromMs + 120_000;
const validFromNs = BigInt(validFromMs) * 1_000_000n;
const validToNs = BigInt(validToMs) * 1_000_000n;
const height = (revisionHeight: bigint) => ({ revisionNumber: 0n, revisionHeight });

function initialDatum(): ClientDatum {
  return {
    token: { policyId: '11'.repeat(28), name: '01' },
    state: {
      clientState: {
        chainId: Buffer.from('delay-0').toString('hex'),
        trustLevel: { numerator: 1n, denominator: 3n },
        trustingPeriod: 1_000_000_000_000n,
        unbondingPeriod: 2_000_000_000_000n,
        maxClockDrift: 10_000_000_000n,
        frozenHeight: height(0n),
        latestHeight: height(2n),
        proofSpecs: [],
      },
      consensusStates: new Map([
        [height(2n), { timestamp: validFromNs, next_validators_hash: 'aa', root: { hash: 'bb' } }],
        // This older state expires inside the validity interval. Pruning must
        // still use the lower bound, independently of the new processing time.
        [height(1n), { timestamp: validFromNs - 950_000_000_000n, next_validators_hash: 'cc', root: { hash: 'dd' } }],
      ]),
      processedTimes: new Map([
        [height(2n), 101n],
        [height(1n), 99n],
      ]),
      processedHeights: new Map([
        [height(2n), 11n],
        [height(1n), 9n],
      ]),
    },
  };
}

async function context(input?: ClientDatum) {
  const tree = new ICS23MerkleTree();
  if (input) {
    tree.set(
      'clients/07-tendermint-0/clientState',
      Buffer.from(await encodeClientStateValue(input.state.clientState, Lucid), 'hex'),
    );
    for (const [h, consensus] of input.state.consensusStates) {
      tree.set(
        `clients/07-tendermint-0/consensusStates/${h.revisionNumber}-${h.revisionHeight}`,
        Buffer.from(await encodeConsensusStateValue(consensus, Lucid), 'hex'),
      );
    }
  }
  const treeContext = createTestTreeContext();
  const hostRef = { txHash: '00'.repeat(32), outputIndex: 0 };
  await treeContext.restore(tree, hostRef);
  const hostDatum: HostStateDatum = {
    nft_policy: '22'.repeat(28),
    deployer: '33'.repeat(28),
    control: { port_registry: new Map(), shutdown: 'Active' },
    state: {
      version: 1n,
      ibc_state_root: tree.getRoot(),
      next_client_sequence: input ? 1n : 0n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: [],
      last_update_time: 0n,
    },
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;
  const deployment = {
    validators: { mintClientStt: { scriptHash: '11'.repeat(28) } },
    hostStateNFT: { policyId: '22'.repeat(28), name: '01' },
  };
  const config = {
    get: jest.fn((key: string) => (key === 'cardanoNetwork' ? 'Preprod' : deployment)),
    getOrThrow: jest.fn().mockReturnValue('http://ogmios.test'),
  } as unknown as ConfigService;
  const lucid: any = {
    LucidImporter: Lucid,
    findUtxoAtHostStateNFT: jest.fn().mockResolvedValue({ ...hostRef, datum: 'host' }),
    decodeDatum: jest.fn().mockResolvedValue(hostDatum),
    encode: jest.fn().mockImplementation(function (data: unknown, type: string) {
      return LucidService.prototype.encode.call(lucid, data, type);
    }),
    generateTokenName: jest.fn().mockReturnValue('01'),
    createUnsignedCreateClientTransaction: jest.fn().mockReturnValue({}),
    createUnsignedUpdateClientTransaction: jest.fn().mockReturnValue({}),
    tryFindUtxosAt: jest.fn().mockResolvedValue([{ assets: { lovelace: 2_000_000n } }]),
    selectWalletFromAddress: jest.fn(),
  };
  const runner: any = {
    run: jest.fn().mockResolvedValue({ unsignedTxCbor: 'abcd', unsignedTxBytes: new Uint8Array([1, 2]) }),
  };
  const service = new ClientService(
    logger,
    config,
    lucid as LucidService,
    runner as TxOperationRunnerService,
    treeContext.store,
  );
  return { service, lucid, runner };
}

describe('ClientService connection-delay processing metadata', () => {
  afterEach(() => jest.restoreAllMocks());

  it('normalizes validity bounds to the exact slot times seen on-chain', async () => {
    const { service } = await context();
    const { zeroTime, zeroSlot } = Lucid.SLOT_CONFIG_NETWORK.Preprod;
    jest.spyOn(time, 'computeLedgerAnchoredValidityWindow').mockResolvedValue({
      currentSlot: zeroSlot + 1000,
      currentLedgerTime: zeroTime + 1_000_000,
      validFromTime: zeroTime + 990_500,
      validToSlot: zeroSlot + 1600,
      validToTime: zeroTime + 1_600_999,
      slotConfig: Lucid.SLOT_CONFIG_NETWORK.Preprod,
    });

    const result = await (service as any).computeTxValidityWindow(9500);

    expect(result.validFromTime).toBe(zeroTime + 990_000);
    expect(result.validToTime).toBe(zeroTime + 1_600_000);
    expect(Lucid.unixTimeToSlot('Preprod', result.validToTime)).toBe(zeroSlot + 1600);
  });

  it('records the upper bound when building the initial client datum', async () => {
    const { service, lucid } = await context();
    const input = initialDatum();
    const consensus = [...input.state.consensusStates.values()][0];

    await service.buildUnsignedCreateClientTx(input.state.clientState, consensus, 'addr_test1signer', validToNs);

    const cbor = lucid.createUnsignedCreateClientTransaction.mock.calls[0][5];
    const output = await decodeClientDatum(cbor, Lucid);
    expect([...output.state.processedTimes.values()]).toEqual([validToNs]);
    expect([...output.state.processedHeights.values()]).toEqual([validToNs / 4_000_000_000n]);
    expect([...output.state.consensusStates.values()][0].timestamp).toBe(validFromNs);
  });

  it('passes the creation transaction upper bound into datum construction', async () => {
    const { service, runner } = await context();
    const input = initialDatum();
    jest.spyOn(validation, 'validateAndFormatCreateClientParams').mockReturnValue({
      constructedAddress: 'addr_test1signer',
      clientState: input.state.clientState,
      consensusState: [...input.state.consensusStates.values()][0],
    });
    (service as any).computeTxValidityWindow = jest
      .fn()
      .mockResolvedValue({ validFromTime: validFromMs, validToTime: validToMs });
    const build = jest.spyOn(service, 'buildUnsignedCreateClientTx');

    await service.createClient({} as any);

    expect(build.mock.calls[0][3]).toBe(validToNs);
    const builder = { validFrom: jest.fn().mockReturnThis(), validTo: jest.fn().mockReturnThis() };
    runner.run.mock.calls[0][0].validity.apply(builder);
    expect(builder.validFrom).toHaveBeenCalledWith(validFromMs);
    expect(builder.validTo).toHaveBeenCalledWith(validToMs);
  });

  it('records the update upper bound and retains history using the lower bound', async () => {
    const input = initialDatum();
    const { service, lucid } = await context(input);
    const header = initializeHeader(headerMockBuilder.build());
    header.trustedHeight = height(2n);
    header.signedHeader.header.chainId = input.state.clientState.chainId;
    header.signedHeader.header.height = 3n;
    header.signedHeader.header.time = validFromNs + 1_000_000_000n;

    await service.buildUnsignedUpdateClientTx({
      clientId: '0',
      header,
      clientDatum: input,
      constructedAddress: 'addr_test1signer',
      clientTokenUnit: '11'.repeat(28) + '01',
      currentClientUtxo: {} as Lucid.UTxO,
      txValidFrom: validFromNs,
      txValidTo: validToNs,
    });

    const cbor = lucid.createUnsignedUpdateClientTransaction.mock.calls[0][5];
    const output = await decodeClientDatum(cbor, Lucid);
    expect([...output.state.consensusStates.keys()]).toEqual([height(3n), height(2n), height(1n)]);
    expect([...output.state.processedTimes.values()]).toEqual([validToNs, 101n, 99n]);
    expect([...output.state.processedHeights.values()]).toEqual([validToNs / 4_000_000_000n, 11n, 9n]);
  });
});
