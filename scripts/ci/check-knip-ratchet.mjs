#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const issueKinds = [
  'exports',
  'types',
  'nsExports',
  'nsTypes',
  'enumMembers',
  'namespaceMembers',
  'duplicates',
];

const scopes = [
  { name: 'gateway', directory: 'cardano/gateway' },
  { name: 'planner', directory: 'packages/cardano-ibc-planner' },
  { name: 'tx-builder', directory: 'packages/cardano-ibc-tx-builder' },
  { name: 'trace-registry', directory: 'packages/cardano-ibc-trace-registry' },
  { name: 'tx-builder-runtime', directory: 'packages/cardano-ibc-tx-builder-runtime' },
];

const allowed = new Set([
  'gateway:src/api/api.dto.ts:exports:Coin',
  'gateway:src/config/bridge-manifest.ts:exports:requireSttDeploymentConfig',
  'gateway:src/config/bridge-manifest.ts:types:BridgeManifestCardanoIdentity',
  'gateway:src/config/bridge-manifest.ts:types:LoadedBridgeConfig',
  'gateway:src/query/services/denom-trace.service.ts:types:TraceRegistryShardStats',
  'gateway:src/query/services/denom-trace.service.ts:types:TraceRegistrySimulationSample',
  'gateway:src/query/services/stability-evidence.ts:types:CardanoHeight',
  'gateway:src/query/services/stability-evidence.ts:types:EpochNumber',
  'gateway:src/query/services/stability-evidence.ts:types:StakeWeightedStabilityEvidence',
  'gateway:src/query/services/stability-evidence.ts:types:StakeWeightedStabilityHeaderEvidence',
  'gateway:src/query/services/stability-evidence.ts:types:StakeWeightedStabilityTxEvidence',
  'gateway:src/shared/helpers/acknowledgement.ts:exports:acknowledgementBytesFromResponse',
  'gateway:src/shared/helpers/cip68-voucher-metadata.ts:exports:VOUCHER_METADATA_VERSION',
  'gateway:src/shared/helpers/cip68-voucher-metadata.ts:exports:decodeVoucherCip68MetadataDatum',
  'gateway:src/shared/helpers/cip68-voucher-metadata.ts:types:BuildVoucherMetadataParams',
  'gateway:src/shared/helpers/cip68-voucher-metadata.ts:types:Cip68VoucherMetadata',
  'gateway:src/shared/helpers/denom-trace.ts:types:DenomTraceParts',
  'gateway:src/shared/helpers/helper.ts:exports:insertSortMap',
  'gateway:src/shared/helpers/helper.ts:exports:sortedStringify',
  'gateway:src/shared/helpers/hex.ts:exports:decode',
  'gateway:src/shared/helpers/hex.ts:exports:decodeString',
  'gateway:src/shared/helpers/hex.ts:exports:decodedLen',
  'gateway:src/shared/helpers/hex.ts:exports:encode',
  'gateway:src/shared/helpers/hex.ts:exports:encodeToString',
  'gateway:src/shared/helpers/hex.ts:exports:encodedLen',
  'gateway:src/shared/helpers/hex.ts:exports:errInvalidByte',
  'gateway:src/shared/helpers/hex.ts:exports:errLength',
  'gateway:src/shared/helpers/hex.ts:exports:fromText',
  'gateway:src/shared/helpers/hex.ts:exports:hashBlake2b224',
  'gateway:src/shared/helpers/hex.ts:exports:toHexString',
  'gateway:src/shared/helpers/hex.ts:exports:toText',
  'gateway:src/shared/helpers/ibc-state-root.ts:exports:computeRootWithChannelUpdate',
  'gateway:src/shared/helpers/ibc-state-root.ts:exports:computeRootWithConnectionUpdate',
  'gateway:src/shared/helpers/ibc-state-root.ts:exports:getCurrentRoot',
  'gateway:src/shared/helpers/ibc-state-root.ts:exports:resetTreeState',
  'gateway:src/shared/helpers/ibc-state-root.ts:types:BindPortStateRootResult',
  'gateway:src/shared/helpers/ibc-state-root.ts:types:CreateChannelStateRootResult',
  'gateway:src/shared/helpers/ibc-state-root.ts:types:CreateClientStateRootResult',
  'gateway:src/shared/helpers/ibc-state-root.ts:types:CreateConnectionStateRootResult',
  'gateway:src/shared/helpers/ibc-state-root.ts:types:HandlePacketStateRootResult',
  'gateway:src/shared/helpers/ibc-state-root.ts:types:StateRootResult',
  'gateway:src/shared/helpers/ibc-state-root.ts:types:UpdateChannelStateRootResult',
  'gateway:src/shared/helpers/ibc-state-root.ts:types:UpdateClientStateRootResult',
  'gateway:src/shared/helpers/ics23-merkle-tree.ts:types:ICS23InnerOp',
  'gateway:src/shared/helpers/ics23-merkle-tree.ts:types:ICS23LeafOp',
  'gateway:src/shared/helpers/merkle-proof.ts:exports:initializeExistenceProof',
  'gateway:src/shared/helpers/merkle-proof.ts:exports:initializeNonExistProof',
  'gateway:src/shared/helpers/module-port.ts:exports:normalizeGatewayPortId',
  'gateway:src/shared/helpers/module-port.ts:types:GatewayModuleConfig',
  'gateway:src/shared/helpers/number.ts:exports:safeAdd',
  'gateway:src/shared/helpers/ogmios.ts:exports:queryCurrentEpochStakeDistribution',
  'gateway:src/shared/helpers/ogmios.ts:exports:queryCurrentEpochVerificationData',
  'gateway:src/shared/helpers/ogmios.ts:types:OgmiosCurrentEpochStakeDistributionEntry',
  'gateway:src/shared/helpers/ogmios.ts:types:OgmiosCurrentEpochVerificationData',
  'gateway:src/shared/helpers/ogmios.ts:types:OgmiosEpochContextAtPoint',
  'gateway:src/shared/helpers/ogmios.ts:types:OgmiosLedgerPoint',
  'gateway:src/shared/helpers/voucher-asset.ts:exports:CIP67_FT_LABEL_HEX',
  'gateway:src/shared/helpers/voucher-asset.ts:exports:CIP67_REFERENCE_NFT_LABEL_HEX',
  'gateway:src/shared/helpers/voucher-asset.ts:exports:LABELED_VOUCHER_TOKEN_NAME_HEX_LENGTH',
  'gateway:src/shared/helpers/voucher-asset.ts:exports:buildVoucherAssetId',
  'gateway:src/shared/helpers/voucher-asset.ts:exports:buildVoucherReferenceTokenNameFromFullDenom',
  'gateway:src/shared/helpers/voucher-asset.ts:exports:buildVoucherUserTokenNameFromFullDenom',
  'gateway:src/shared/helpers/voucher-asset.ts:exports:isVoucherAssetName',
  'gateway:src/shared/helpers/voucher-asset.ts:exports:isVoucherReferenceTokenName',
  'gateway:src/shared/helpers/voucher-asset.ts:exports:isVoucherUserTokenName',
  'gateway:src/shared/helpers/voucher-asset.ts:types:ParsedVoucherAssetName',
  'gateway:src/shared/helpers/voucher-asset.ts:types:VoucherLabelKind',
  'gateway:src/shared/helpers/voucher-presentation.ts:exports:deriveVoucherCanonicalLabel',
  'gateway:src/shared/helpers/voucher-presentation.ts:types:VoucherPresentation',
  'gateway:src/shared/modules/lucid/dtos/packet/fragments.ts:types:TraceRegistryAppendUpdate',
  'gateway:src/shared/modules/lucid/dtos/packet/fragments.ts:types:TraceRegistryExistingProof',
  'gateway:src/shared/modules/lucid/dtos/packet/fragments.ts:types:TraceRegistryRolloverUpdate',
  'gateway:src/shared/modules/lucid/dtos/packet/fragments.ts:types:WithChannelToken',
  'gateway:src/shared/modules/lucid/dtos/packet/fragments.ts:types:WithMockModuleSpend',
  'gateway:src/shared/modules/lucid/dtos/packet/fragments.ts:types:WithMockModuleUtxo',
  'gateway:src/shared/modules/lucid/dtos/packet/fragments.ts:types:WithPolicyId',
  'gateway:src/shared/modules/lucid/lucid.service.ts:types:CodecType',
  'gateway:src/shared/modules/mithril/dtos/get-certificate-by-hash.dto.ts:exports:CertificateDetailMetadata',
  'gateway:src/shared/modules/mithril/dtos/get-certificate-by-hash.dto.ts:exports:SignerDetail',
  'gateway:src/shared/modules/mithril/dtos/get-registerd-signers-for-epoch.dto.ts:exports:RegistrationDTO',
  'gateway:src/shared/types/apps/async-icq/async-icq.ts:exports:ASYNC_ICQ_CHANNEL_VERSION',
  'gateway:src/shared/types/apps/async-icq/async-icq.ts:exports:CosmosQueryCodec',
  'gateway:src/shared/types/apps/async-icq/async-icq.ts:exports:CosmosResponseCodec',
  'gateway:src/shared/types/apps/async-icq/async-icq.ts:exports:TendermintRequestQueryCodec',
  'gateway:src/shared/types/apps/async-icq/async-icq.ts:exports:TendermintResponseQueryCodec',
  'gateway:src/shared/types/apps/async-icq/async-icq.ts:exports:decodeAsyncIcqAcknowledgementBytes',
  'gateway:src/shared/types/apps/async-icq/async-icq.ts:types:CosmosQuery',
  'gateway:src/shared/types/apps/async-icq/async-icq.ts:types:DecodedAsyncIcqAcknowledgement',
  'gateway:src/shared/types/apps/async-icq/async-icq.ts:types:InterchainQueryPacketAck',
  'gateway:src/shared/types/apps/async-icq/async-icq.ts:types:InterchainQueryPacketData',
  'gateway:src/shared/types/apps/async-icq/vesseloracle-icq.ts:exports:VESSELORACLE_QUERY_PATH',
  'gateway:src/shared/types/apps/transfer/mint_voucher_redeemer/mint-voucher-redeemer.ts:exports:decodeMintVoucherRedeemer',
  'gateway:src/shared/types/apps/transfer/transfer_module_redeemer/transfer-module-redeemer.ts:exports:castToTransferModuleRedeemer',
  'gateway:src/shared/types/apps/transfer/transfer_module_redeemer/transfer-module-redeemer.ts:exports:encodeTransferModuleRedeemer',
  'gateway:src/shared/types/apps/transfer/types/fungible-token-packet-data.ts:exports:castToFungibleTokenPacket',
  'gateway:src/shared/types/apps/transfer/types/fungible-token-packet-data.ts:exports:decodeFungibleTokenPacketDatum',
  'gateway:src/shared/types/apps/transfer/types/fungible-token-packet-data.ts:exports:encodeFungibleTokenPacketDatum',
  'gateway:src/shared/types/channel/channel-datum.ts:types:ChannelDatumState',
  'gateway:src/shared/types/cometbft/commit.ts:types:CommitSig',
  'gateway:src/shared/types/cometbft/commit.ts:types:PartSetHeader',
  'gateway:src/shared/types/cometbft/header.ts:types:ConsensusVersion',
  'gateway:src/shared/types/cometbft/validator-set.ts:exports:validateBasic',
  'gateway:src/shared/types/header.ts:exports:verify',
  'gateway:src/shared/types/isc-23/merkle.ts:types:CommitmentProof_Proof',
  'gateway:src/shared/types/isc-23/merkle.ts:types:InnerOp',
  'gateway:src/shared/types/isc-23/merkle.ts:types:LeafOp',
  'gateway:src/shared/types/port/ibc_module_redeemer.ts:types:IBCModuleOperator',
  'gateway:src/shared/types/port/ibc_module_redeemer.ts:types:IBCModulePacketData',
  'gateway:src/shared/types/schema-fragments.ts:exports:createIcs23LeafOpSchema',
  'gateway:src/shared/types/schema-fragments.ts:exports:createMithrilClientStateSchema',
  'gateway:src/shared/types/schema-fragments.ts:exports:createProofSpecSchema',
  'gateway:src/shared/types/trace-registry.ts:types:TraceRegistryEntry',
  'gateway:src/shared/types/trace-registry.ts:types:TraceRegistryRedeemer',
  'gateway:src/tx/dto/packet/send-packet-operator.dto.ts:types:Coin',
  'gateway:src/tx/helper/helper.ts:exports:decodeClientStateMithril',
  'gateway:src/tx/tx-events.service.ts:types:GatewayEventAttribute',
  'gateway:src/tx/tx-operation-runner.service.ts:types:CompletedUnsignedTx',
  'gateway:src/tx/tx-operation-runner.service.ts:types:TxCompleteOptions',
  'gateway:src/tx/tx-operation-runner.service.ts:types:TxCompleteRetryPolicy',
  'gateway:src/tx/tx-operation-runner.service.ts:types:TxOperationPlan',
  'gateway:src/tx/tx-operation-runner.service.ts:types:TxOperationRunnerResult',
  'gateway:src/tx/tx-operation-runner.service.ts:types:TxValidityPolicy',
  'gateway:src/tx/tx-operation-runner.service.ts:types:TxWalletInstruction',
  'tx-builder-runtime:src/lucidIbcAdapter.ts:types:AuthToken',
  'tx-builder-runtime:src/lucidIbcAdapter.ts:types:CodecType',
  'tx-builder-runtime:src/lucidIbcAdapter.ts:types:DeploymentConfig',
]);

function collectIssueKeys(scope, data) {
  const keys = [];
  for (const issue of data.issues ?? []) {
    for (const kind of issueKinds) {
      for (const entry of issue[kind] ?? []) {
        keys.push(`${scope.name}:${issue.file}:${kind}:${entry.name}`);
      }
    }
  }
  return keys;
}

const seen = new Set();
const unexpected = [];

for (const scope of scopes) {
  const result = spawnSync(
    'npx',
    [
      '--yes',
      'knip@6.11.0',
      '--directory',
      scope.directory,
      '--exports',
      '--reporter',
      'json',
      '--no-exit-code',
      '--no-progress',
    ],
    { encoding: 'utf8' },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(result.status ?? 1);
  }

  const data = JSON.parse(result.stdout);
  for (const key of collectIssueKeys(scope, data)) {
    seen.add(key);
    if (!allowed.has(key)) {
      unexpected.push(key);
    }
  }
}

const stale = [...allowed].filter((key) => !seen.has(key));

if (unexpected.length > 0 || stale.length > 0) {
  if (unexpected.length > 0) {
    console.error('Unexpected unused exports/types found:');
    for (const key of unexpected.sort()) {
      console.error(`- ${key}`);
    }
  }

  if (stale.length > 0) {
    console.error('Stale Knip allowlist entries found:');
    for (const key of stale.sort()) {
      console.error(`- ${key}`);
    }
  }

  process.exit(1);
}

console.log(`Knip unused export ratchet passed (${seen.size} baseline issues).`);
