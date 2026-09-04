import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Lucid from '@lucid-evolution/lucid';

import { ICS23MerkleTree } from '../../shared/helpers/ics23-merkle-tree';
import { setCurrentTree } from '../../shared/helpers/ibc-state-root';
import { ClientDatum } from '../../shared/types/client-datum';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import { ClientService } from '../client.service';
import { TxOperationRunnerService } from '../tx-operation-runner.service';

const height = (revisionHeight: bigint) => ({ revisionNumber: 0n, revisionHeight });

function clientDatum(
  latestHeight: bigint,
  timestamp: bigint,
  options: {
    frozen?: boolean;
    chainId?: string;
    processedTime?: bigint;
    processedHeight?: bigint;
  } = {},
): ClientDatum {
  const latest = height(latestHeight);
  return {
    token: { policyId: '11'.repeat(28), name: Buffer.from(latestHeight.toString()).toString('hex') },
    state: {
      clientState: {
        chainId: options.chainId ?? Buffer.from('chain-0').toString('hex'),
        trustLevel: { numerator: 1n, denominator: 3n },
        trustingPeriod: 100n,
        unbondingPeriod: 200n,
        maxClockDrift: 10n,
        frozenHeight: options.frozen ? height(1n) : height(0n),
        latestHeight: latest,
        proofSpecs: [],
      },
      consensusStates: new Map([[latest, { timestamp, next_validators_hash: 'aa', root: { hash: 'bb' } }]]),
      processedTimes: new Map([[latest, options.processedTime ?? timestamp]]),
      processedHeights: new Map([[latest, options.processedHeight ?? latestHeight]]),
    },
  };
}

function validationService(): any {
  return Object.create(ClientService.prototype);
}

describe('ClientService recovery validation', () => {
  const validTo = 200n;

  it('accepts an expired subject and active newer substitute', () => {
    expect(
      validationService().validateRecoveryState(clientDatum(1n, 0n), clientDatum(2n, 150n), validTo),
    ).toMatchObject({ height: height(2n), processedTime: 150n, processedHeight: 2n });
  });

  it('rejects an active subject', () => {
    expect(() =>
      validationService().validateRecoveryState(clientDatum(1n, 150n), clientDatum(2n, 150n), validTo),
    ).toThrow('Subject client must be frozen or expired');
  });

  it('rejects an inactive substitute', () => {
    expect(() =>
      validationService().validateRecoveryState(clientDatum(1n, 0n), clientDatum(2n, 150n, { frozen: true }), validTo),
    ).toThrow('Substitute client must be active');
  });

  it('rejects mismatched immutable parameters', () => {
    expect(() =>
      validationService().validateRecoveryState(
        clientDatum(1n, 0n),
        clientDatum(2n, 150n, { chainId: Buffer.from('other-0').toString('hex') }),
        validTo,
      ),
    ).toThrow('parameters do not match');
  });

  it('rejects a substitute that is not newer', () => {
    expect(() =>
      validationService().validateRecoveryState(clientDatum(2n, 0n), clientDatum(1n, 150n), validTo),
    ).toThrow('must be newer');
  });

  it('rejects missing substitute processed metadata', () => {
    const substitute = clientDatum(2n, 150n);
    substitute.state.processedTimes.clear();

    expect(() => validationService().validateRecoveryState(clientDatum(1n, 0n), substitute, validTo)).toThrow(
      'missing processed metadata',
    );
  });

  it('rejects extra subject processed metadata keys', () => {
    const subject = clientDatum(1n, 0n);
    subject.state.processedTimes.set(height(9n), 9n);

    expect(() => validationService().validateRecoveryState(subject, clientDatum(2n, 150n), validTo)).toThrow(
      'processed metadata keys do not match',
    );
  });
});

describe('ClientService recovery transaction', () => {
  function serviceContext() {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;
    const deployment = {
      validators: { recoverClient: { address: 'stake_test1recovery', refUtxo: { txHash: 'ref', outputIndex: 0 } } },
    };
    const config = { get: jest.fn().mockReturnValue(deployment) } as unknown as ConfigService;
    const lucid: any = {
      LucidImporter: Lucid,
      findUtxoAtHostStateNFT: jest.fn(),
      getPaymentCredential: jest.fn(),
      getClientTokenUnit: jest.fn((id: string) => `unit-${id}`),
      findUtxoByUnit: jest.fn(),
      decodeDatum: jest.fn(),
      tryFindUtxosAt: jest.fn().mockResolvedValue([{ assets: { lovelace: 2_000_000n } }]),
      selectWalletFromAddress: jest.fn(),
      encode: jest.fn().mockImplementation((_data: unknown, type: string) => Promise.resolve(`encoded-${type}`)),
      createUnsignedRecoverClientTransaction: jest.fn().mockReturnValue({}),
    };
    const runner: any = { run: jest.fn().mockResolvedValue({ unsignedTxBytes: new Uint8Array([1, 2]) }) };
    const service = new ClientService(logger, config, lucid as LucidService, runner as TxOperationRunnerService);
    (service as any).computeTxValidityWindow = jest.fn().mockResolvedValue({
      validFromTime: 100,
      validToTime: 200,
    });
    return { service, deployment, lucid, runner };
  }

  it('builds an authorized recovery response', async () => {
    const { service, lucid, runner } = serviceContext();
    const hostUtxo = { datum: 'host' };
    const subjectUtxo = { datum: 'subject' };
    const substituteUtxo = { datum: 'substitute' };
    lucid.findUtxoAtHostStateNFT.mockResolvedValue(hostUtxo);
    lucid.getPaymentCredential.mockReturnValue({ type: 'Key', hash: 'deployer' });
    lucid.findUtxoByUnit.mockImplementation((unit: string) =>
      Promise.resolve(unit === 'unit-1' ? subjectUtxo : substituteUtxo),
    );
    lucid.decodeDatum.mockImplementation((datum: string) => {
      if (datum === 'host') return Promise.resolve({ deployer: 'deployer', state: { ibc_state_root: '00' } });
      return Promise.resolve(datum === 'subject' ? clientDatum(1n, 0n) : clientDatum(2n, 150_000_000n));
    });
    const buildResult = { unsignedTx: {}, pendingTreeUpdate: { expectedNewRoot: 'root', commit: jest.fn() } };
    jest.spyOn(service, 'buildUnsignedRecoverClientTx').mockResolvedValue(buildResult as any);

    await expect(
      service.recoverClient({
        subject_client_id: '07-tendermint-1',
        substitute_client_id: '07-tendermint-2',
        signer: 'addr_test1authority',
      }),
    ).resolves.toEqual({ unsigned_tx: { type_url: '', value: new Uint8Array([1, 2]) } });
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ operationName: 'recoverClient', pendingTreeUpdate: buildResult.pendingTreeUpdate }),
    );
  });

  it('fails clearly when recovery is not deployed', async () => {
    const { service, deployment } = serviceContext();
    delete (deployment.validators as any).recoverClient;

    await expect(
      service.recoverClient({
        subject_client_id: '07-tendermint-1',
        substitute_client_id: '07-tendermint-2',
        signer: 'addr_test1authority',
      }),
    ).rejects.toThrow('not configured');
  });

  it('rejects a signer that is not the recovery authority', async () => {
    const { service, lucid } = serviceContext();
    lucid.findUtxoAtHostStateNFT.mockResolvedValue({ datum: 'host' });
    lucid.decodeDatum.mockResolvedValue({ deployer: 'deployer', state: {} });
    lucid.getPaymentCredential.mockReturnValue({ type: 'Key', hash: 'someone-else' });

    await expect(
      service.recoverClient({
        subject_client_id: '07-tendermint-1',
        substitute_client_id: '07-tendermint-2',
        signer: 'addr_test1authority',
      }),
    ).rejects.toThrow('does not match');
  });

  it('caps subject history at 300 entries and commits the matching root update', async () => {
    const { service, lucid } = serviceContext();
    const subject = clientDatum(300n, 0n, { frozen: true });
    const consensusEntries: Array<[ReturnType<typeof height>, any]> = [];
    const timeEntries: Array<[ReturnType<typeof height>, bigint]> = [];
    const heightEntries: Array<[ReturnType<typeof height>, bigint]> = [];
    const tree = new ICS23MerkleTree();
    tree.set('clients/07-tendermint-1/clientState', Buffer.from('old-client'));
    for (let value = 300n; value >= 1n; value--) {
      const key = height(value);
      consensusEntries.push([key, { timestamp: 0n, next_validators_hash: 'aa', root: { hash: 'bb' } }]);
      timeEntries.push([key, value]);
      heightEntries.push([key, value]);
      tree.set(`clients/07-tendermint-1/consensusStates/${value}`, Buffer.from([Number(value % 255n)]));
    }
    subject.state.consensusStates = new Map(consensusEntries);
    subject.state.processedTimes = new Map(timeEntries);
    subject.state.processedHeights = new Map(heightEntries);
    setCurrentTree(tree);
    const recoveredDatums: ClientDatum[] = [];
    lucid.encode.mockImplementation((data: unknown, type: string) => {
      if (type === 'client') recoveredDatums.push(data as ClientDatum);
      return Promise.resolve(`encoded-${type}`);
    });

    const result = await service.buildUnsignedRecoverClientTx({
      subjectClientId: '1',
      substituteClientId: '2',
      constructedAddress: 'addr_test1authority',
      subjectClientDatum: subject,
      substituteClientDatum: clientDatum(301n, 150n),
      subjectClientTokenUnit: 'unit-1',
      subjectClientUtxo: {} as any,
      substituteClientUtxo: {} as any,
      hostStateUtxo: {} as any,
      hostStateDatum: {
        deployer: 'deployer',
        nft_policy: 'host-policy',
        control: { port_registry: new Map(), shutdown: 'Active' },
        state: {
          version: 1n,
          ibc_state_root: tree.getRoot(),
          next_client_sequence: 3n,
          next_connection_sequence: 0n,
          next_channel_sequence: 0n,
          bound_port: [],
          last_update_time: 0n,
        },
      },
      signerKeyHash: 'deployer',
      txValidTo: 200n,
    });

    const recovered = recoveredDatums[0];
    expect(recovered.state.consensusStates.size).toBe(300);
    expect(Array.from(recovered.state.consensusStates.keys())[0]).toEqual(height(301n));
    expect(Array.from(recovered.state.consensusStates.keys()).at(-1)).toEqual(height(2n));
    expect(result.pendingTreeUpdate.expectedNewRoot).not.toBe(tree.getRoot());
    expect(lucid.createUnsignedRecoverClientTransaction).toHaveBeenCalled();
  });
});
