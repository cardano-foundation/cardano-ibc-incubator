import { assert, assertEquals } from "@std/assert";
import {
  Data,
  fromText,
  getAddressDetails,
  Lucid,
  PROTOCOL_PARAMETERS_DEFAULT,
  type TxSigned,
  type UTxO,
  validatorToScriptHash,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { Emulator } from "@lucid-evolution/provider";
import { HostStateDatum, HostStateNftRedeemer } from "../types/index.ts";
import { loadDeploymentPlan } from "./deployment-plan.ts";
import {
  REFERENCE_UTXO_DEDICATED_FUNDING_FEE_BUFFER_LOVELACE,
  shouldUseDedicatedReferenceFunding,
} from "./deployment.ts";
import {
  buildHostStateBootstrapTx,
  buildMockTokenMintTx,
  buildReferenceBatchTx,
  completeReferenceBatchTx,
} from "./deployment-transactions.ts";

const MAX_TX_SIZE = 16_384;
// Public BIP-39 test vector; this wallet is only funded inside the Emulator.
const TEST_SEED = "abandon ".repeat(11) + "about";
const TEST_TIME = 1_700_000_000_000;

async function deploymentFixture() {
  const address = walletFromSeed(TEST_SEED, {
    addressType: "Base",
    accountIndex: 0,
    network: "Custom",
  }).address;
  const emulator = new Emulator(
    [1_000_000_000n, 5_000_000n, 20_000_000n, 20_000_000n, 20_000_000n]
      .map((lovelace) => ({
        seedPhrase: TEST_SEED,
        privateKey: "",
        address,
        assets: { lovelace },
      })),
    { ...PROTOCOL_PARAMETERS_DEFAULT, maxTxSize: MAX_TX_SIZE },
  );
  emulator.time = TEST_TIME;
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(TEST_SEED);
  const walletUtxos = await lucid.wallet().getUtxos();
  const nonceUtxo = walletUtxos.find(({ outputIndex }) => outputIndex === 2)!;
  const paymentCredential = getAddressDetails(address).paymentCredential;
  assert(paymentCredential?.type === "Key");
  const outref = (index: number) => ({
    transaction_id: nonceUtxo.txHash,
    output_index: BigInt(index),
  });
  const plan = await loadDeploymentPlan(lucid, {
    hostStateNonce: outref(2),
    transferModuleNonce: outref(3),
    traceDirectoryNonce: outref(4),
    deployerPaymentKeyHash: paymentCredential.hash,
    benchmarkVoucherEnabled: true,
  });
  return { lucid, emulator, address, nonceUtxo, plan };
}

function assertSignedTransactionFits(signed: TxSigned, label: string) {
  const transaction = signed.toTransaction();
  const body = transaction.body();
  assert(body.fee() > 0n, `${label}: the balanced transaction has a fee`);
  assertEquals(transaction.witness_set().vkeywitnesses()?.len(), 1);
  const signedBytes = signed.toCBOR().length / 2;
  assert(
    signedBytes <= MAX_TX_SIZE,
    `${label}: signed transaction is ${signedBytes} bytes, above ${MAX_TX_SIZE}`,
  );
  console.log(
    `${label}: ${signedBytes} signed bytes, fee ${body.fee()} lovelace`,
  );
}

Deno.test("every applied reference validator fits its signed production transaction", async (t) => {
  const { plan: inventory } = await deploymentFixture();
  for (const { title } of inventory.referenceValidators) {
    await t.step(title, async () => {
      const { lucid, emulator, address, plan } = await deploymentFixture();
      const validator = plan.referenceValidators.find((entry) =>
        entry.title === title
      )!;
      const validators = [validator.script];
      let dedicatedFunding: UTxO | undefined;
      if (shouldUseDedicatedReferenceFunding(validators, MAX_TX_SIZE)) {
        const { totalOutputAssets } = await buildReferenceBatchTx(
          lucid,
          plan.referenceHolder.address,
          validators,
        ).config();
        const fundingLovelace = totalOutputAssets.lovelace +
          REFERENCE_UTXO_DEDICATED_FUNDING_FEE_BUFFER_LOVELACE;
        const funding = await lucid.newTx()
          .pay.ToAddress(address, { lovelace: fundingLovelace })
          .complete();
        const signedFunding = await funding.sign.withWallet().complete();
        assertSignedTransactionFits(signedFunding, `fund ${title}`);
        const fundingHash = await signedFunding.submit();
        emulator.awaitBlock();
        dedicatedFunding = (await lucid.wallet().getUtxos()).find((utxo) =>
          utxo.txHash === fundingHash &&
          utxo.assets.lovelace === fundingLovelace
        );
        assert(dedicatedFunding);
      }

      const result = await completeReferenceBatchTx(
        lucid,
        plan.referenceHolder.address,
        validators,
        dedicatedFunding,
      );
      assertSignedTransactionFits(result.signedTx, title);
      const referenceOutputs = result.outputs.filter(({ scriptRef }) =>
        scriptRef
      );
      assertEquals(referenceOutputs.length, 1);
      assertEquals(referenceOutputs[0].address, plan.referenceHolder.address);
      assertEquals(referenceOutputs[0].datum, Data.void());
      assertEquals(
        validatorToScriptHash(referenceOutputs[0].scriptRef!),
        validator.hash,
      );
      assertEquals(referenceOutputs[0].txHash, result.signedTx.toHash());
      assert(result.consumedWalletInputs.length > 0);
      const body = result.signedTx.toTransaction().body();
      if (dedicatedFunding) {
        assertEquals(body.inputs().len(), 1);
        assertEquals(body.outputs().len(), 1);
        assertEquals(
          body.fee(),
          REFERENCE_UTXO_DEDICATED_FUNDING_FEE_BUFFER_LOVELACE,
        );
        assertEquals(result.consumedWalletInputs, [dedicatedFunding]);
      } else {
        assert(result.outputs.some((output) => output.address === address));
      }
      const inputLovelace = result.consumedWalletInputs.reduce(
        (total, input) => total + input.assets.lovelace,
        0n,
      );
      const outputLovelace = result.outputs.reduce(
        (total, output) => total + output.assets.lovelace,
        0n,
      );
      assertEquals(inputLovelace, outputLovelace + body.fee());
      assertEquals(await result.signedTx.submit(), result.signedTx.toHash());
      emulator.awaitBlock();
      const published = await lucid.utxosAt(plan.referenceHolder.address);
      assertEquals(published.length, 1);
      assertEquals(published[0].txHash, result.signedTx.toHash());
    });
  }
});

Deno.test("ordinary reference batches balance change and preserve every script output", async () => {
  const { lucid, emulator, address, plan } = await deploymentFixture();
  const validators = [plan.mintIdentifier.script, plan.mintPort.script];
  assertEquals(
    shouldUseDedicatedReferenceFunding(validators, MAX_TX_SIZE),
    false,
  );
  const result = await completeReferenceBatchTx(
    lucid,
    plan.referenceHolder.address,
    validators,
  );
  assertSignedTransactionFits(result.signedTx, "bootstrap reference batch");
  const references = result.outputs.filter(({ scriptRef }) => scriptRef);
  assertEquals(
    references.map(({ scriptRef }) => validatorToScriptHash(scriptRef!)).sort(),
    validators.map(validatorToScriptHash).sort(),
  );
  assert(result.outputs.some((output) => output.address === address));
  // Fixed inputs and witnesses make this a reproducible measurement.
  const repeated = await completeReferenceBatchTx(
    lucid,
    plan.referenceHolder.address,
    validators,
  );
  assertEquals(repeated.signedTx.toCBOR(), result.signedTx.toCBOR());
  assertEquals(await result.signedTx.submit(), result.signedTx.toHash());
  emulator.awaitBlock();
  assertEquals((await lucid.utxosAt(plan.referenceHolder.address)).length, 2);
});

Deno.test("HostState bootstrap evaluates and fits with inline policy, datum and wallet witness", async () => {
  const { lucid, emulator, nonceUtxo, plan } = await deploymentFixture();
  const hostStateNftUnit = plan.hostNft.hash + fromText("ibc_host_state");
  const datum: HostStateDatum = {
    state: {
      version: 0n,
      ibc_state_root: "00".repeat(32),
      next_client_sequence: 0n,
      next_connection_sequence: 0n,
      next_channel_sequence: 0n,
      bound_port: [],
      last_update_time: BigInt(TEST_TIME),
    },
    nft_policy: plan.hostNft.hash,
    deployer: plan.inputs.deployerPaymentKeyHash,
    control: { port_registry: new Map(), shutdown: "Active" },
  };
  const encodedDatum = Data.to(datum, HostStateDatum, { canonical: true });
  const completed = await buildHostStateBootstrapTx(lucid, {
    nonceUtxo,
    mintingPolicy: plan.hostNft.script,
    hostStateNftUnit,
    hostStateAddress: plan.hostState.address,
    encodedDatum,
    encodedRedeemer: Data.to("MintInitial", HostStateNftRedeemer, {
      canonical: true,
    }),
  }).complete({ localUPLCEval: true });
  const signed = await completed.sign.withWallet().complete();
  assertSignedTransactionFits(signed, "MintHostStateNFT");
  const transaction = signed.toTransaction();
  const scripts = transaction.witness_set().plutus_v3_scripts();
  assertEquals(scripts?.len(), 1);
  assertEquals(scripts!.get(0).hash().to_hex(), plan.hostNft.hash);
  assertEquals(transaction.body().reference_inputs()?.len() ?? 0, 0);
  assertEquals(await signed.submit(), signed.toHash());
  emulator.awaitBlock();
  const [host] = await lucid.utxosAt(plan.hostState.address);
  assertEquals(host.assets[hostStateNftUnit], 1n);
  assertEquals(host.datum, encodedDatum);
  assertEquals(host.scriptRef, undefined);
  assertEquals(await lucid.utxosByOutRef([nonceUtxo]), []);
});

Deno.test("mock token mint fits with inline policy, wallet witness and token change", async () => {
  const { lucid, emulator, address, plan } = await deploymentFixture();
  const tokenUnit = plan.mockToken.hash + fromText("mock");
  const completed = await buildMockTokenMintTx(
    lucid,
    plan.mockToken.script,
    tokenUnit,
    address,
  ).complete({ localUPLCEval: true });
  const signed = await completed.sign.withWallet().complete();
  assertSignedTransactionFits(signed, "Mint mock token");
  const transaction = signed.toTransaction();
  const scripts = transaction.witness_set().plutus_v3_scripts();
  assertEquals(scripts?.len(), 1);
  assertEquals(scripts!.get(0).hash().to_hex(), plan.mockToken.hash);
  assertEquals(transaction.body().reference_inputs()?.len() ?? 0, 0);
  assertEquals(await signed.submit(), signed.toHash());
  emulator.awaitBlock();
  const mintedOutputs = (await lucid.utxosAt(address)).filter((utxo) =>
    utxo.txHash === signed.toHash()
  );
  assertEquals(mintedOutputs.length, 2);
  assertEquals(
    mintedOutputs.map((utxo) => utxo.assets[tokenUnit]).sort(),
    [999_999_999n, 9_000_000_000n].sort(),
  );
  assertEquals(
    mintedOutputs.reduce((total, utxo) => total + utxo.assets[tokenUnit], 0n),
    9_999_999_999n,
  );
});
