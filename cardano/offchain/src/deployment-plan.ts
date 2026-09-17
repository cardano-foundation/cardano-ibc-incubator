import {
  Data,
  fromText,
  type LucidEvolution,
  type Script,
} from "@lucid-evolution/lucid";
import {
  AuthTokenSchema,
  type OutputReference,
  OutputReferenceSchema,
} from "../types/index.ts";
import {
  generateIdentifierTokenName,
  generatePortTokenName,
  readValidator,
} from "./utils.ts";
import {
  AddressSchema,
  assertEmergencyAuthority,
  assertGovernance,
  type Authority,
  AuthoritySchema,
  CredentialSchema,
  type Governance,
  GovernanceSchema,
  plutusAddress,
} from "../types/plutus/Migration.ts";
import { CHANNEL_OPERATION_NAMES, initialRegistry } from "./migration-plan.ts";
import { TRANSFER_MODULE_PORT } from "./constants.ts";

export const GENERIC_MODULE_SPEND_VALIDATOR_TITLE =
  "spending_mock_module.spend_mock_module.spend";
export type Publication = "bootstrap" | "runtime" | "inline";
export type PlannedValidator = {
  title: string;
  publication: Publication;
  script: Script;
  hash: string;
  address: string;
};
export type DeploymentPlanInputs = {
  hostStateNonce: OutputReference;
  transferModuleNonce: OutputReference;
  traceDirectoryNonce: OutputReference;
  deployerPaymentKeyHash: string;
  benchmarkVoucherEnabled: boolean;
  migration?: {
    registryNonce: OutputReference;
    governance: Governance;
    emergency: Authority;
  };
};

export const loadStagedTendermintValidators = (
  lucid: LucidEvolution,
  hostStateNftPolicyId: string,
  recoveryScriptHash: string,
) => {
  const [sessionSpendValidator, sessionSpendScriptHash, sessionSpendAddress] =
    readValidator(
      "spending_tendermint_update_session.spend_tendermint_update_session.spend",
      lucid,
      [hostStateNftPolicyId],
      Data.Tuple([Data.Bytes()]) as unknown as [string],
    );

  const [sessionMintValidator, sessionMintPolicyId, sessionMintAddress] =
    readValidator(
      "minting_tendermint_update_session.mint_tendermint_update_session.mint",
      lucid,
      [sessionSpendScriptHash],
      Data.Tuple([Data.Bytes()]) as unknown as [string],
    );

  const [clientSpendValidator, clientSpendScriptHash, clientSpendAddress] =
    readValidator(
      "spending_multitx_client.spend_multitx_client.spend",
      lucid,
      [hostStateNftPolicyId, sessionMintPolicyId, {
        Script: [recoveryScriptHash],
      }],
      Data.Tuple([
        Data.Bytes(),
        Data.Bytes(),
        Data.Enum([
          Data.Object({ VerificationKey: Data.Tuple([Data.Bytes()]) }),
          Data.Object({ Script: Data.Tuple([Data.Bytes()]) }),
        ]),
      ]) as unknown as [string, string, { Script: [string] }],
    );

  return {
    sessionSpend: {
      validator: sessionSpendValidator,
      scriptHash: sessionSpendScriptHash,
      address: sessionSpendAddress,
    },
    sessionMint: {
      validator: sessionMintValidator,
      policyId: sessionMintPolicyId,
      address: sessionMintAddress,
    },
    clientSpend: {
      validator: clientSpendValidator,
      scriptHash: clientSpendScriptHash,
      address: clientSpendAddress,
    },
  };
};

export const buildChannelValidators = (
  lucid: LucidEvolution,
  mintClientPolicyId: string,
  mintConnectionPolicyId: string,
  mintPortPolicyId: string,
  verifyProofScriptHash: string,
  hostStateNftPolicyId: string,
) => {
  const names = CHANNEL_OPERATION_NAMES;
  const load = (title: string, args: string[]): PlannedValidator => {
    const [script, hash, address] = readValidator(title, lucid, args);
    return { title, publication: "runtime", script, hash, address };
  };
  const referredScripts: Record<string, PlannedValidator> = {};
  for (const name of names) {
    const args = name === "prune_packet_history"
      ? [mintClientPolicyId, mintConnectionPolicyId, verifyProofScriptHash]
      : [mintClientPolicyId, mintConnectionPolicyId, mintPortPolicyId];
    if (
      !["prune_packet_history", "send_packet", "chan_close_init"].includes(name)
    ) {
      args.push(verifyProofScriptHash);
    }
    if (name !== "prune_packet_history") args.push(hostStateNftPolicyId);
    referredScripts[name] = load(`spending_channel/${name}.${name}.mint`, args);
  }
  const base = load("spending_channel.spend_channel.spend", [
    ...CHANNEL_OPERATION_NAMES.map((name) => referredScripts[name].hash),
    hostStateNftPolicyId,
  ]);
  return { base, referredScripts };
};

/** Load the fully applied HostState used by production deployment. */
export const loadHostStateValidator = (
  lucid: LucidEvolution,
  hostPolicy: string,
  clientHash: string,
  connectionHash: string,
  channelHash: string,
  clientMintPolicyId: string,
  connectionMintPolicyId: string,
  channelMintPolicyId: string,
) =>
  readValidator(
    "host_state_stt.host_state_stt.spend",
    lucid,
    [
      hostPolicy,
      clientHash,
      connectionHash,
      channelHash,
      clientMintPolicyId,
      connectionMintPolicyId,
      channelMintPolicyId,
    ],
    Data.Tuple([
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]) as unknown as [string, string, string, string, string, string, string],
  );

/**
 * Complete, deterministic script graph for a deployment. This performs no
 * provider queries or submissions. Publications are recorded as scripts are
 * loaded; deployment and preflight consume this same inventory.
 */
export const loadDeploymentPlan = async (
  lucid: LucidEvolution,
  inputs: DeploymentPlanInputs,
) => {
  const validators: PlannedValidator[] = [];
  const register = (
    title: string,
    publication: Publication,
    loaded: ReturnType<typeof readValidator>,
  ) => {
    const [script, hash, address] = loaded;
    const validator = { title, publication, script, hash, address };
    validators.push(validator);
    return validator;
  };
  const load = (
    title: string,
    publication: Publication,
    params?: unknown[],
    schema?: unknown,
  ) =>
    register(
      title,
      publication,
      readValidator(
        title,
        lucid,
        params as Data[] | undefined,
        schema as Data[] | undefined,
      ),
    );
  const bytes = (...values: string[]) => values;
  const hostNft = load("host_state_nft.host_state_nft.mint", "inline", [
    inputs.hostStateNonce,
  ], Data.Tuple([OutputReferenceSchema]));
  const hostPolicy = hostNft.hash;
  const verifyProof = load("verifying_proof.verify_proof.mint", "runtime");
  const mintPort = load(
    "minting_port.mint_port.mint",
    "bootstrap",
    bytes(hostPolicy),
  );
  const recoverClient = load(
    "recover_client.recover_client.withdraw",
    "runtime",
    bytes(hostPolicy),
  );
  const implementationRegistry = inputs.migration
    ? load("implementation_registry.implementation_registry.spend", "runtime")
    : null;
  if (inputs.migration) {
    assertGovernance(inputs.migration.governance);
    assertEmergencyAuthority(
      inputs.migration.emergency,
      inputs.migration.governance,
    );
  }
  const mintImplementationRegistry = inputs.migration && implementationRegistry
    ? load(
      "minting_implementation_registry.mint_implementation_registry.mint",
      "inline",
      [
        inputs.migration.registryNonce,
        plutusAddress(implementationRegistry.address),
        hostPolicy,
        inputs.migration.governance,
        inputs.migration.emergency,
      ],
      Data.Tuple([
        OutputReferenceSchema,
        AddressSchema,
        Data.Bytes(),
        GovernanceSchema,
        AuthoritySchema,
      ]),
    )
    : null;
  const registryPolicy = mintImplementationRegistry?.hash;
  const staged = loadStagedTendermintValidators(
    lucid,
    hostPolicy,
    recoverClient.hash,
  );
  const sessionSpend = register(
    "spending_tendermint_update_session.spend_tendermint_update_session.spend",
    "runtime",
    [
      staged.sessionSpend.validator,
      staged.sessionSpend.scriptHash,
      staged.sessionSpend.address,
    ],
  );
  const sessionMint = register(
    "minting_tendermint_update_session.mint_tendermint_update_session.mint",
    "runtime",
    [
      staged.sessionMint.validator,
      staged.sessionMint.policyId,
      staged.sessionMint.address,
    ],
  );
  const spendClient = registryPolicy
    ? load(
      "upgradeable/client.client.spend",
      "runtime",
      [
        registryPolicy,
        1n,
        hostPolicy,
        sessionMint.hash,
        { Script: [recoverClient.hash] },
      ],
      Data.Tuple([
        Data.Bytes(),
        Data.Integer(),
        Data.Bytes(),
        Data.Bytes(),
        CredentialSchema,
      ]),
    )
    : register(
      "spending_multitx_client.spend_multitx_client.spend",
      "runtime",
      [
        staged.clientSpend.validator,
        staged.clientSpend.scriptHash,
        staged.clientSpend.address,
      ],
    );
  const mintClient = registryPolicy
    ? load("upgradeable/mint_client.mint_client.mint", "runtime", [
      registryPolicy,
    ])
    : load(
      "minting_client_stt.mint_client_stt.mint",
      "runtime",
      bytes(spendClient.hash, hostPolicy),
    );
  const spendConnection = registryPolicy
    ? load(
      "upgradeable/connection.connection.spend",
      "runtime",
      [registryPolicy, 1n, hostPolicy, mintClient.hash, verifyProof.hash],
      Data.Tuple([
        Data.Bytes(),
        Data.Integer(),
        Data.Bytes(),
        Data.Bytes(),
        Data.Bytes(),
      ]),
    )
    : load(
      "spending_connection.spend_connection.spend",
      "runtime",
      bytes(mintClient.hash, verifyProof.hash, hostPolicy),
    );
  const mintConnection = registryPolicy
    ? load("upgradeable/mint_connection.mint_connection.mint", "runtime", [
      registryPolicy,
      verifyProof.hash,
    ])
    : load(
      "minting_connection_stt.mint_connection_stt.mint",
      "runtime",
      bytes(
        mintClient.hash,
        verifyProof.hash,
        spendConnection.hash,
        hostPolicy,
      ),
    );
  const { base: legacySpendChannel, referredScripts } = buildChannelValidators(
    lucid,
    mintClient.hash,
    mintConnection.hash,
    mintPort.hash,
    verifyProof.hash,
    hostPolicy,
  );
  validators.push(...Object.values(referredScripts));
  const spendChannel = registryPolicy
    ? load(
      "upgradeable/channel.channel.spend",
      "runtime",
      [
        registryPolicy,
        1n,
        hostPolicy,
        CHANNEL_OPERATION_NAMES.map((name) => referredScripts[name].hash),
      ],
      Data.Tuple([
        Data.Bytes(),
        Data.Integer(),
        Data.Bytes(),
        Data.Array(Data.Bytes()),
      ]),
    )
    : legacySpendChannel;
  if (!registryPolicy) validators.push(spendChannel);
  const mintChannel = registryPolicy
    ? load("upgradeable/mint_channel.mint_channel.mint", "runtime", [
      registryPolicy,
      mintPort.hash,
      verifyProof.hash,
      recoverClient.hash,
    ])
    : load(
      "minting_channel_stt.mint_channel_stt.mint",
      "runtime",
      bytes(
        mintClient.hash,
        mintConnection.hash,
        mintPort.hash,
        verifyProof.hash,
        spendChannel.hash,
        hostPolicy,
        recoverClient.hash,
      ),
    );
  const hostState = registryPolicy
    ? load("upgradeable/host_state.host_state.spend", "bootstrap", [
      registryPolicy,
      1n,
    ], Data.Tuple([Data.Bytes(), Data.Integer()]))
    : register(
      "host_state_stt.host_state_stt.spend",
      "bootstrap",
      loadHostStateValidator(
        lucid,
        hostPolicy,
        spendClient.hash,
        spendConnection.hash,
        spendChannel.hash,
        mintClient.hash,
        mintConnection.hash,
        mintChannel.hash,
      ),
    );
  const mintIdentifier = load(
    "minting_identifier.minting_identifier.mint",
    "bootstrap",
  );
  const directoryAuthToken = {
    policy_id: mintIdentifier.hash,
    name: await generateIdentifierTokenName(inputs.traceDirectoryNonce),
  };
  const identifierToken = {
    policy_id: mintIdentifier.hash,
    name: await generateIdentifierTokenName(inputs.transferModuleNonce),
  };
  const voucherMetadata = load(
    "voucher_metadata.voucher_metadata.spend",
    "runtime",
    bytes(hostPolicy),
  );
  const mintVoucher = load(
    "minting_voucher.mint_voucher.mint",
    "runtime",
    [
      identifierToken,
      directoryAuthToken,
      voucherMetadata.hash,
      mintChannel.hash,
      hostPolicy,
    ],
    Data.Tuple([
      AuthTokenSchema,
      AuthTokenSchema,
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]),
  );
  const portId = fromText(TRANSFER_MODULE_PORT);
  const portToken = {
    policy_id: mintPort.hash,
    name: generatePortTokenName(portId),
  };
  const mintTransferEscrowShard = load(
    "minting_transfer_escrow_shard.mint_transfer_escrow_shard.mint",
    "runtime",
    [portToken, hostPolicy],
    Data.Tuple([AuthTokenSchema, Data.Bytes()]),
  );
  const spendTransferModule = registryPolicy
    ? load(
      "upgradeable/transfer.transfer.spend",
      "runtime",
      [
        registryPolicy,
        1n,
        hostPolicy,
        mintChannel.hash,
        mintTransferEscrowShard.hash,
        portToken,
        identifierToken,
        mintVoucher.hash,
        recoverClient.hash,
      ],
      Data.Tuple([
        Data.Bytes(),
        Data.Integer(),
        Data.Bytes(),
        Data.Bytes(),
        Data.Bytes(),
        AuthTokenSchema,
        AuthTokenSchema,
        Data.Bytes(),
        Data.Bytes(),
      ]),
    )
    : load(
      "spending_transfer_module.spend_transfer_module.spend",
      "runtime",
      [
        portToken,
        identifierToken,
        portId,
        mintTransferEscrowShard.hash,
        mintChannel.hash,
        mintVoucher.hash,
        hostPolicy,
        recoverClient.hash,
      ],
      Data.Tuple([
        AuthTokenSchema,
        AuthTokenSchema,
        Data.Bytes(),
        Data.Bytes(),
        Data.Bytes(),
        Data.Bytes(),
        Data.Bytes(),
        Data.Bytes(),
      ]),
    );
  const benchmarkVoucher = inputs.benchmarkVoucherEnabled
    ? load(
      "minting_trace_registry_benchmark_voucher.mint_trace_registry_benchmark_voucher.mint",
      "runtime",
    )
    : null;
  const traceRegistry = load(
    "trace_registry.spend_trace_registry.spend",
    "runtime",
    [
      mintIdentifier.hash,
      directoryAuthToken,
      mintVoucher.hash,
      benchmarkVoucher?.hash ?? "",
      hostPolicy,
    ],
    Data.Tuple([
      Data.Bytes(),
      AuthTokenSchema,
      Data.Bytes(),
      Data.Bytes(),
      Data.Bytes(),
    ]),
  );
  const genericModule = load(
    GENERIC_MODULE_SPEND_VALIDATOR_TITLE,
    "runtime",
    bytes(hostPolicy),
  );
  const referenceHolder = load(
    "reference_validator.refer_only.else",
    "inline",
    bytes(hostPolicy),
  );
  const mockToken = load("minting_mock_token.mint_mock_token.mint", "inline");

  const plan = {
    inputs,
    implementationRegistry,
    mintImplementationRegistry,
    validators,
    referenceValidators: validators.filter(({ publication }) =>
      publication !== "inline"
    ),
    inlineValidators: validators.filter(({ publication }) =>
      publication === "inline"
    ),
    hostNft,
    verifyProof,
    mintPort,
    recoverClient,
    sessionSpend,
    sessionMint,
    spendClient,
    mintClient,
    spendConnection,
    mintConnection,
    spendingChannel: { base: spendChannel, referredScripts },
    mintChannel,
    hostState,
    mintIdentifier,
    directoryAuthToken,
    voucherMetadata,
    mintVoucher,
    mintTransferEscrowShard,
    spendTransferModule,
    benchmarkVoucher,
    traceRegistry,
    genericModule,
    referenceHolder,
    mockToken,
  };
  return {
    ...plan,
    registry: inputs.migration ? await initialRegistry(plan) : null,
  };
};
export type DeploymentPlan = Awaited<ReturnType<typeof loadDeploymentPlan>>;

/** Stable, real-width inputs for CI measurements, independent of live wallets. */
export const DEPLOYMENT_PLAN_FIXTURE: Omit<
  DeploymentPlanInputs,
  "benchmarkVoucherEnabled" | "migration"
> = {
  hostStateNonce: { transaction_id: "11".repeat(32), output_index: 0n },
  transferModuleNonce: { transaction_id: "22".repeat(32), output_index: 1n },
  traceDirectoryNonce: { transaction_id: "33".repeat(32), output_index: 2n },
  deployerPaymentKeyHash: "44".repeat(28),
};
