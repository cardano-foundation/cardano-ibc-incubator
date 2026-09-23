import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  getAddressDetails,
  Lucid,
  type LucidEvolution,
  PROTOCOL_PARAMETERS_DEFAULT,
  type UTxO,
  validatorToScriptHash,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { Emulator } from "@lucid-evolution/provider";
import { loadDeploymentPlan } from "./deployment-plan.ts";
import { createReferenceUtxos, deployTraceRegistry } from "./deployment.ts";
import { TRACE_REGISTRY_SHARD_COUNT } from "./constants.ts";
import {
  assertDisjointTxInputs,
  completeAndSignTx,
  generateIdentifierTokenName,
} from "./utils.ts";

const MAX_TX_SIZE = 16_384;
// Public BIP-39 test vector; this wallet is only funded inside the Emulator.
const TEST_SEED = "abandon ".repeat(11) + "about";
const TEST_TIME = 1_700_000_000_000;
const NONCE_LOVELACE = 20_000_000n;
// Wallet outputs: funding, collateral, then the directory nonce followed by
// one nonce per trace-registry shard.
const FUNDING_INDEX = 0;
const COLLATERAL_INDEX = 1;
const DIRECTORY_NONCE_INDEX = 2;

// Deployment confirms adoption through the provider when Kupo is not set.
Deno.env.delete("KUPO_URL");

const refKey = (utxo: UTxO) => `${utxo.txHash}#${utxo.outputIndex}`;

async function batchingFixture() {
  const address = walletFromSeed(TEST_SEED, {
    addressType: "Base",
    accountIndex: 0,
    network: "Custom",
  }).address;
  const emulator = new Emulator(
    [
      50_000_000_000n,
      5_000_000n,
      ...Array(1 + TRACE_REGISTRY_SHARD_COUNT).fill(NONCE_LOVELACE),
    ].map((lovelace) => ({
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
  const walletUtxos = (await lucid.wallet().getUtxos()).sort((a, b) =>
    a.outputIndex - b.outputIndex
  );
  const paymentCredential = getAddressDetails(address).paymentCredential;
  assert(paymentCredential?.type === "Key");
  const outref = (index: number) => ({
    transaction_id: walletUtxos[index].txHash,
    output_index: BigInt(index),
  });
  const plan = await loadDeploymentPlan(lucid, {
    hostStateNonce: outref(FUNDING_INDEX),
    transferModuleNonce: outref(COLLATERAL_INDEX),
    traceDirectoryNonce: outref(DIRECTORY_NONCE_INDEX),
    deployerPaymentKeyHash: paymentCredential.hash,
    benchmarkVoucherEnabled: false,
  });
  return { lucid, emulator, address, walletUtxos, plan };
}

/**
 * Produce a block whenever submissions have been quiet for one tick, and record
 * the block height each transaction was submitted at. Transactions submitted at
 * the same height are adopted in the same block.
 */
function startBlockProducer(emulator: Emulator) {
  const submittedAt: number[] = [];
  const submit = emulator.submitTx.bind(emulator);
  emulator.submitTx = (tx: string) => {
    submittedAt.push(emulator.blockHeight);
    return submit(tx);
  };
  let seen = 0;
  const timer = setInterval(() => {
    if (submittedAt.length === seen) emulator.awaitBlock();
    seen = submittedAt.length;
  }, 50);
  return { submittedAt, stop: () => clearInterval(timer) };
}

function reserveWalletUtxos(lucid: LucidEvolution, reserved: UTxO[]) {
  return async () => {
    const reservedRefs = new Set(reserved.map(refKey));
    lucid.overrideUTxOs([]);
    const spendable = (await lucid.wallet().getUtxos()).filter((utxo) =>
      !reservedRefs.has(refKey(utxo))
    );
    lucid.overrideUTxOs(spendable);
    return reservedRefs;
  };
}

Deno.test("batched transactions may not spend the same input", async () => {
  const { lucid, walletUtxos } = await batchingFixture();
  const nonce = walletUtxos[DIRECTORY_NONCE_INDEX];
  const spendNonce = (label: string) =>
    completeAndSignTx(
      () => lucid.newTx().collectFrom([nonce]),
      lucid,
      label,
      false,
      { coinSelection: false },
    );
  const first = await spendNonce("first");
  const second = await spendNonce("second");
  assertThrows(
    () => assertDisjointTxInputs([first, second]),
    Error,
    `both spend ${refKey(nonce)}`,
  );
});

Deno.test("trace registry shards and directory are adopted in one block", async () => {
  const { lucid, emulator, walletUtxos, plan } = await batchingFixture();
  const nonceUtxos = [
    ...walletUtxos.slice(DIRECTORY_NONCE_INDEX + 1),
    walletUtxos[DIRECTORY_NONCE_INDEX],
  ];
  assertEquals(nonceUtxos.length, TRACE_REGISTRY_SHARD_COUNT + 1);
  // Deployment hides every reserved nonce from coin selection.
  await reserveWalletUtxos(lucid, nonceUtxos)();

  const producer = startBlockProducer(emulator);
  let registry;
  try {
    registry = await deployTraceRegistry(
      lucid,
      plan.mintIdentifier.script,
      plan.directoryAuthToken,
      nonceUtxos,
      plan.traceRegistry,
    );
  } finally {
    producer.stop();
  }

  assertEquals(producer.submittedAt.length, TRACE_REGISTRY_SHARD_COUNT + 1);
  assertEquals(new Set(producer.submittedAt).size, 1);

  lucid.overrideUTxOs([]);
  const threads = await lucid.utxosAt(plan.traceRegistry.address);
  assertEquals(threads.length, TRACE_REGISTRY_SHARD_COUNT + 1);
  const policyId = plan.mintIdentifier.hash;
  for (const [index, shard] of registry.shards.entries()) {
    assertEquals(shard.index, BigInt(index));
    assertEquals(
      shard.token.name,
      await generateIdentifierTokenName({
        transaction_id: nonceUtxos[index].txHash,
        output_index: BigInt(nonceUtxos[index].outputIndex),
      }),
    );
    assert(threads.some((utxo) => utxo.assets[policyId + shard.token.name]));
  }
  assert(
    threads.some((utxo) =>
      utxo.assets[policyId + plan.directoryAuthToken.name] === 1n
    ),
  );
  // Each thread paid for itself from its nonce; no other wallet input moved.
  const remaining = new Set((await lucid.wallet().getUtxos()).map(refKey));
  assert(remaining.has(refKey(walletUtxos[FUNDING_INDEX])));
  assert(remaining.has(refKey(walletUtxos[COLLATERAL_INDEX])));
  for (const nonce of nonceUtxos) assert(!remaining.has(refKey(nonce)));
});

Deno.test("reference scripts are published by one chained funding round", async () => {
  const { lucid, emulator, walletUtxos, plan } = await batchingFixture();
  const validators = plan.referenceValidators
    .filter(({ publication }) => publication === "runtime")
    .map(({ script }) => script);
  assert(validators.length > 10);
  const reserved = walletUtxos.slice(COLLATERAL_INDEX);
  const reservedRefs = await reserveWalletUtxos(lucid, reserved)();

  const producer = startBlockProducer(emulator);
  let published;
  try {
    published = await createReferenceUtxos(
      lucid,
      plan.referenceHolder.address,
      validators,
      reservedRefs,
    );
  } finally {
    producer.stop();
  }

  assertEquals(
    Object.keys(published).sort(),
    validators.map(validatorToScriptHash).sort(),
  );
  lucid.overrideUTxOs([]);
  const onChain = await lucid.utxosAt(plan.referenceHolder.address);
  assertEquals(onChain.length, validators.length);
  for (const [hash, utxo] of Object.entries(published)) {
    const live = onChain.find((candidate) =>
      refKey(candidate) === refKey(utxo)
    );
    assert(live?.scriptRef);
    assertEquals(validatorToScriptHash(live.scriptRef), hash);
  }

  // One funding transaction plus one transaction per batch, sent in waves that
  // each fit one block body instead of one block per transaction.
  const blocks = new Set(producer.submittedAt).size;
  console.log(
    `${producer.submittedAt.length} reference transactions in ${blocks} block(s)`,
  );
  assert(producer.submittedAt.length > blocks);
  assert(blocks <= 4, `expected at most 4 blocks, used ${blocks}`);
  // Reserved nonces and collateral are untouched.
  const remaining = new Set((await lucid.wallet().getUtxos()).map(refKey));
  for (const utxo of reserved) assert(remaining.has(refKey(utxo)));
});
