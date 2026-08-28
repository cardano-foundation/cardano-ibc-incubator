import {
  CML,
  Data,
  Emulator,
  generateEmulatorAccountFromPrivateKey,
  Lucid,
  validatorToRewardAddress,
} from '@lucid-evolution/lucid';

import { LucidService } from './lucid.service';

describe('LucidService Tendermint proof withdrawal', () => {
  const makeBuilder = () => {
    const builder: any = {
      readFrom: jest.fn(),
      collectFrom: jest.fn(),
      pay: { ToContract: jest.fn() },
      withdraw: jest.fn(),
    };
    builder.readFrom.mockReturnValue(builder);
    builder.collectFrom.mockReturnValue(builder);
    builder.pay.ToContract.mockReturnValue(builder);
    builder.withdraw.mockReturnValue(builder);
    return builder;
  };

  const makeService = (includeProofReference = true) => {
    const builder = makeBuilder();
    const proofReference = { txHash: 'proof-ref', outputIndex: 0 };
    const service = {
      configService: {
        get: jest.fn().mockReturnValue({
          hostStateNFT: { policyId: 'aa'.repeat(28), name: 'bb' },
          validators: {
            hostStateStt: { address: 'addr_test1host' },
            spendClient: { scriptHash: '11'.repeat(28), address: 'addr_test1client' },
            tendermintProof: { scriptHash: '22'.repeat(28) },
          },
        }),
      },
      lucid: { config: () => ({ network: 'Preprod' }) },
      referenceScripts: {
        hostStateStt: { txHash: 'host-ref', outputIndex: 0 },
        spendClient: { txHash: 'client-ref', outputIndex: 0 },
        ...(includeProofReference ? { tendermintProof: proofReference } : {}),
      },
      newTxBuilder: () => builder,
    };
    return { service, builder, proofReference };
  };

  const hostStateUtxo = { txHash: 'host-input', outputIndex: 0, assets: {} } as any;
  const clientUtxo = { txHash: 'client-input', outputIndex: 1, assets: {} } as any;

  it('uses the proof reference script and a zero withdrawal carrying the proof redeemer', () => {
    const { service, builder, proofReference } = makeService();

    const result = LucidService.prototype.createUnsignedUpdateClientTransaction.call(
      service as any,
      hostStateUtxo,
      'host-redeemer',
      clientUtxo,
      'client-redeemer',
      'host-datum',
      'client-datum',
      'client-unit',
      'addr_test1operator',
      'proof-redeemer',
    );

    expect(result).toBe(builder);
    expect(builder.readFrom).toHaveBeenCalledWith([
      service.referenceScripts.hostStateStt,
      service.referenceScripts.spendClient,
      proofReference,
    ]);
    expect(builder.withdraw).toHaveBeenCalledWith(expect.stringMatching(/^stake_test1/), 0n, 'proof-redeemer');
  });

  it('refuses proof mode without a deployed proof reference script', () => {
    const { service } = makeService(false);

    expect(() =>
      LucidService.prototype.createUnsignedUpdateClientTransaction.call(
        service as any,
        hostStateUtxo,
        'host-redeemer',
        clientUtxo,
        'client-redeemer',
        'host-datum',
        'client-datum',
        'client-unit',
        'addr_test1operator',
        'proof-redeemer',
      ),
    ).toThrow('Missing Tendermint proof-validator reference script');
  });

  it('keeps a zero script withdrawal, Reward redeemer, and proof reference input in serialized CBOR', async () => {
    const proofValidator = { type: 'PlutusV3' as const, script: '450100002499' };
    const payerAccount = generateEmulatorAccountFromPrivateKey({ lovelace: 100_000_000n });
    const collateralAccount = { ...payerAccount, assets: { lovelace: 50_000_000n } };
    const referenceAccount = generateEmulatorAccountFromPrivateKey({ lovelace: 5_000_000n });
    referenceAccount.outputData = { scriptRef: proofValidator };
    const emulator = new Emulator([payerAccount, collateralAccount, referenceAccount]);
    const lucid = await Lucid(emulator, 'Custom');
    lucid.selectWallet.fromPrivateKey(payerAccount.privateKey);
    const proofReference = (await emulator.getUtxos(referenceAccount.address))[0];
    const proofRewardAddress = validatorToRewardAddress('Custom', proofValidator);

    const completed = await lucid
      .newTx()
      .readFrom([proofReference])
      .withdraw(proofRewardAddress, 0n, Data.void())
      .complete({ localUPLCEval: false });
    const transaction = CML.Transaction.from_cbor_hex(completed.toCBOR());

    const withdrawals = transaction.body().withdrawals();
    expect(withdrawals).toBeDefined();
    expect(withdrawals!.keys().len()).toBe(1);
    const rewardAccount = withdrawals!.keys().get(0);
    expect(rewardAccount.to_address().to_bech32()).toBe(proofRewardAddress);
    expect(withdrawals!.get(rewardAccount).toString()).toBe('0');

    const referenceInputs = transaction.body().reference_inputs();
    expect(referenceInputs).toBeDefined();
    expect(referenceInputs!.len()).toBe(1);
    expect(referenceInputs!.get(0).transaction_id().to_hex()).toBe(proofReference.txHash);
    expect(referenceInputs!.get(0).index()).toBe(BigInt(proofReference.outputIndex));

    const redeemers = transaction.witness_set().redeemers();
    const legacyRedeemers = redeemers?.as_arr_legacy_redeemer();
    expect(legacyRedeemers).toBeDefined();
    expect(legacyRedeemers!.len()).toBe(1);
    expect(legacyRedeemers!.get(0).tag()).toBe(CML.RedeemerTag.Reward);
    expect(legacyRedeemers!.get(0).index()).toBe(0n);
    expect(legacyRedeemers!.get(0).data().to_cbor_hex()).toBe(Data.void());
  });
});
