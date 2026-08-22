import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Network, TxBuilder, UTxO } from '@lucid-evolution/lucid';

import {
  GrpcFailedPreconditionException,
  GrpcInternalException,
  GrpcInvalidArgumentException,
} from '~@/exception/grpc_exceptions';
import { TRANSACTION_SET_COLLATERAL, TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';

import {
  alignTreeWithChain,
  computeRootWithPruneTerminalClientUpdate,
  computeRootWithReclaimChannelUpdate,
  computeRootWithReclaimClientUpdate,
  computeRootWithReclaimConnectionUpdate,
  isTreeAligned,
} from '../shared/helpers/ibc-state-root';
import { convertHex2String, convertString2Hex } from '../shared/helpers/hex';
import { parseChannelSequence, parseClientSequence, parseConnectionSequence } from '../shared/helpers/sequence';
import { computeLedgerAnchoredValidityWindow } from '../shared/helpers/time';
import { getGatewayModuleConfigForPortId } from '../shared/helpers/module-port';
import { LucidService } from '../shared/modules/lucid/lucid.service';
import { ClientDatum, encodeClientStateValue, encodeConsensusStateValue } from '../shared/types/client-datum';
import { Height } from '../shared/types/height';
import { HostStateDatum } from '../shared/types/host-state-datum';
import { ConnectionDatum, encodeConnectionEndValue } from '../shared/types/connection/connection-datum';
import { ChannelDatum, encodeChannelEndValue } from '../shared/types/channel/channel-datum';
import { IBCModuleRedeemer } from '../shared/types/port/ibc_module_redeemer';
import {
  ChannelLifecycleRequest,
  ClientLifecycleRequest,
  ConnectionLifecycleRequest,
  CoreLifecycleTxResponse,
} from './dto/core-lifecycle.dto';
import { TxOperationRunnerService } from './tx-operation-runner.service';
import { PacketService } from './packet.service';

const LIFECYCLE_DELAY_MS = 604_800_000n;

type ValidityWindow = Awaited<ReturnType<typeof computeLedgerAnchoredValidityWindow>>;

@Injectable()
export class CoreLifecycleService {
  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    @Inject(LucidService) private readonly lucidService: LucidService,
    private readonly txOperationRunnerService: TxOperationRunnerService,
    private readonly packetService: PacketService,
  ) {}

  async pruneTerminalClient(request: ClientLifecycleRequest): Promise<CoreLifecycleTxResponse> {
    this.requireKeySigner(request.signer);
    const clientId = this.requireClientId(request.client_id);
    const validity = await this.computeValidityWindow();
    const { hostUtxo, hostDatum } = await this.resolveHost();
    this.assertHostMutable(hostDatum);
    await this.ensureTreeAligned(hostDatum.state.ibc_state_root);

    const clientTokenUnit = this.lucidService.getClientTokenUnit(parseClientSequence(clientId));
    const clientUtxo = await this.requireDatumUtxo(
      await this.lucidService.findUtxoByUnit(clientTokenUnit),
      `client ${clientId}`,
    );
    const clientDatum = await this.lucidService.decodeDatum<ClientDatum>(clientUtxo.datum!, 'client');
    this.assertAuthToken(clientDatum.token, clientTokenUnit, `client ${clientId}`, clientUtxo);
    const entries = this.validateClientConsensusMetadata(clientDatum);
    this.assertTerminalClient(clientDatum, entries[0][1].timestamp, validity.validFromTime);
    if (entries.length < 2) {
      throw new GrpcFailedPreconditionException(`Client ${clientId} has no non-latest consensus state to prune`);
    }

    const removed = entries.slice(1, 3);
    const removedKeys = new Set(removed.map(([height]) => this.heightKey(height)));
    const updatedClientDatum: ClientDatum = {
      ...clientDatum,
      state: {
        ...clientDatum.state,
        consensusStates: new Map(entries.filter(([height]) => !removedKeys.has(this.heightKey(height)))),
        processedTimes: new Map(
          Array.from(clientDatum.state.processedTimes.entries()).filter(
            ([height]) => !removedKeys.has(this.heightKey(height)),
          ),
        ),
        processedHeights: new Map(
          Array.from(clientDatum.state.processedHeights.entries()).filter(
            ([height]) => !removedKeys.has(this.heightKey(height)),
          ),
        ),
      },
    };
    const rootUpdate = computeRootWithPruneTerminalClientUpdate(
      hostDatum.state.ibc_state_root,
      clientId,
      await Promise.all(
        removed.map(async ([height, consensus]) => ({
          height: height.revisionHeight,
          value: Buffer.from(await encodeConsensusStateValue(consensus, this.lucidService.LucidImporter), 'hex'),
        })),
      ),
    );
    const updatedHost = this.updatedHost(hostDatum, validity, rootUpdate.newRoot);
    const unsignedTx = this.lucidService.createUnsignedPruneTerminalClientTransaction({
      hostStateUtxo: hostUtxo,
      clientUtxo,
      encodedHostStateRedeemer: await this.lucidService.encode(
        { PruneTerminalClient: { removed_consensus_state_siblings: rootUpdate.removedConsensusStateSiblings } },
        'host_state_redeemer',
      ),
      encodedClientRedeemer: await this.lucidService.encode('PruneTerminalConsensusStates', 'spendClientRedeemer'),
      encodedUpdatedHostStateDatum: await this.lucidService.encode(updatedHost, 'host_state'),
      encodedUpdatedClientDatum: await this.lucidService.encode(updatedClientDatum, 'client'),
      clientTokenUnit,
    });
    return this.complete('pruneTerminalClient', request.signer, unsignedTx, validity, rootUpdate);
  }

  async reclaimClient(request: ClientLifecycleRequest): Promise<CoreLifecycleTxResponse> {
    const signer = this.requireKeySigner(request.signer);
    const clientId = this.requireClientId(request.client_id);
    const validity = await this.computeValidityWindow();
    const { hostUtxo, hostDatum } = await this.resolveHost();
    this.assertHostMutable(hostDatum);
    if (hostDatum.state.live_client_count <= 0n) {
      throw new GrpcFailedPreconditionException('HostState has no live client to reclaim');
    }
    await this.ensureTreeAligned(hostDatum.state.ibc_state_root);

    const clientTokenUnit = this.lucidService.getClientTokenUnit(parseClientSequence(clientId));
    const clientUtxo = await this.requireDatumUtxo(
      await this.lucidService.findUtxoByUnit(clientTokenUnit),
      `client ${clientId}`,
    );
    const clientDatum = await this.lucidService.decodeDatum<ClientDatum>(clientUtxo.datum!, 'client');
    this.assertAuthToken(clientDatum.token, clientTokenUnit, `client ${clientId}`, clientUtxo);
    const entries = this.validateClientConsensusMetadata(clientDatum);
    if (entries.length !== 1) {
      throw new GrpcFailedPreconditionException(
        `Client ${clientId} must retain exactly its latest consensus state before reclaim`,
      );
    }
    this.assertTerminalClient(clientDatum, entries[0][1].timestamp, validity.validFromTime);

    const clientStateValue = Buffer.from(
      await encodeClientStateValue(clientDatum.state.clientState, this.lucidService.LucidImporter),
      'hex',
    );
    const consensusStateValue = Buffer.from(
      await encodeConsensusStateValue(entries[0][1], this.lucidService.LucidImporter),
      'hex',
    );
    const rootUpdate = computeRootWithReclaimClientUpdate(
      hostDatum.state.ibc_state_root,
      clientId,
      clientStateValue,
      entries[0][0].revisionHeight,
      consensusStateValue,
    );
    const reclaimAddress = this.lucidService.credentialToAddress(signer.hash);
    const updatedHost = this.updatedHost(hostDatum, validity, rootUpdate.newRoot, {
      live_client_count: hostDatum.state.live_client_count - 1n,
    });
    const reclaimTo = signer.hash;
    const unsignedTx = this.lucidService.createUnsignedReclaimClientTransaction({
      hostStateUtxo: hostUtxo,
      clientUtxo,
      encodedHostStateRedeemer: await this.lucidService.encode(
        {
          ReclaimClient: {
            reclaim_to: reclaimTo,
            client_state_siblings: rootUpdate.clientStateSiblings,
            consensus_state_siblings: rootUpdate.consensusStateSiblings,
            client_connection_count_siblings: rootUpdate.clientConnectionCountSiblings,
          },
        },
        'host_state_redeemer',
      ),
      encodedClientRedeemer: await this.lucidService.encode(
        { ReclaimClient: { reclaim_to: reclaimTo } },
        'spendClientRedeemer',
      ),
      encodedMintClientRedeemer: await this.lucidService.encode(
        { BurnClient: { token: clientDatum.token, reclaim_to: reclaimTo } },
        'mintClientRedeemer',
      ),
      encodedUpdatedHostStateDatum: await this.lucidService.encode(updatedHost, 'host_state'),
      clientTokenUnit,
      reclaimAddress,
    });
    return this.complete('reclaimClient', request.signer, unsignedTx, validity, rootUpdate);
  }

  async beginConnectionRetirement(request: ConnectionLifecycleRequest): Promise<CoreLifecycleTxResponse> {
    const signer = this.requireKeySigner(request.signer);
    const connectionId = this.requireConnectionId(request.connection_id);
    const validity = await this.computeValidityWindow();
    const { hostUtxo, hostDatum } = await this.resolveHost();
    this.assertHostMutable(hostDatum);
    this.assertDeployer(hostDatum, signer.hash);
    const [policyId, tokenName] = this.lucidService.getConnectionTokenUnit(parseConnectionSequence(connectionId));
    const tokenUnit = policyId + tokenName;
    const connectionUtxo = await this.requireDatumUtxo(
      await this.lucidService.findUtxoByUnit(tokenUnit),
      `connection ${connectionId}`,
    );
    const connectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(connectionUtxo.datum!, 'connection');
    this.assertAuthToken(connectionDatum.token, tokenUnit, `connection ${connectionId}`, connectionUtxo);
    if (connectionDatum.lifecycle !== 'ConnectionActive') {
      throw new GrpcFailedPreconditionException(`Connection ${connectionId} is already retiring`);
    }
    const notBefore = BigInt(validity.validFromTime) + LIFECYCLE_DELAY_MS;
    const updatedConnection: ConnectionDatum = {
      ...connectionDatum,
      lifecycle: { Retiring: { not_before: notBefore } },
    };
    const updatedHost = this.updatedHost(hostDatum, validity, hostDatum.state.ibc_state_root);
    const unsignedTx = this.lucidService.createUnsignedBeginConnectionRetirementTransaction({
      hostStateUtxo: hostUtxo,
      connectionUtxo,
      encodedHostStateRedeemer: await this.lucidService.encode('BeginConnectionRetirement', 'host_state_redeemer'),
      encodedConnectionRedeemer: await this.lucidService.encode(
        { BeginConnectionRetirement: { not_before: notBefore } },
        'spendConnectionRedeemer',
      ),
      encodedUpdatedHostStateDatum: await this.lucidService.encode(updatedHost, 'host_state'),
      encodedUpdatedConnectionDatum: await this.lucidService.encode(updatedConnection, 'connection'),
      connectionTokenUnit: tokenUnit,
      signerKeyHash: signer.hash,
    });
    return this.completeUnchanged(
      'beginConnectionRetirement',
      request.signer,
      unsignedTx,
      validity,
      hostDatum.state.ibc_state_root,
    );
  }

  async reclaimConnection(request: ConnectionLifecycleRequest): Promise<CoreLifecycleTxResponse> {
    const signer = this.requireKeySigner(request.signer);
    const connectionId = this.requireConnectionId(request.connection_id);
    const validity = await this.computeValidityWindow();
    const { hostUtxo, hostDatum } = await this.resolveHost();
    this.assertHostMutable(hostDatum);
    if (hostDatum.state.live_connection_count <= 0n) {
      throw new GrpcFailedPreconditionException('HostState has no live connection to reclaim');
    }
    await this.ensureTreeAligned(hostDatum.state.ibc_state_root);
    const [policyId, tokenName] = this.lucidService.getConnectionTokenUnit(parseConnectionSequence(connectionId));
    const tokenUnit = policyId + tokenName;
    const connectionUtxo = await this.requireDatumUtxo(
      await this.lucidService.findUtxoByUnit(tokenUnit),
      `connection ${connectionId}`,
    );
    const connectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(connectionUtxo.datum!, 'connection');
    this.assertAuthToken(connectionDatum.token, tokenUnit, `connection ${connectionId}`, connectionUtxo);
    if (
      connectionDatum.lifecycle === 'ConnectionActive' ||
      connectionDatum.live_channel_count !== 0n ||
      BigInt(validity.validFromTime) < connectionDatum.lifecycle.Retiring.not_before
    ) {
      throw new GrpcFailedPreconditionException(`Connection ${connectionId} is not reclaimable`);
    }
    const clientId = convertHex2String(connectionDatum.state.client_id);
    const connectionValue = Buffer.from(
      await encodeConnectionEndValue(connectionDatum.state, this.lucidService.LucidImporter),
      'hex',
    );
    const rootUpdate = computeRootWithReclaimConnectionUpdate(
      hostDatum.state.ibc_state_root,
      connectionId,
      connectionValue,
      clientId,
    );
    const reclaimAddress = this.lucidService.credentialToAddress(signer.hash);
    const updatedHost = this.updatedHost(hostDatum, validity, rootUpdate.newRoot, {
      live_connection_count: hostDatum.state.live_connection_count - 1n,
    });
    const unsignedTx = this.lucidService.createUnsignedReclaimConnectionTransaction({
      hostStateUtxo: hostUtxo,
      connectionUtxo,
      encodedHostStateRedeemer: await this.lucidService.encode(
        {
          ReclaimConnection: {
            reclaim_to: signer.hash,
            connection_siblings: rootUpdate.connectionSiblings,
            client_connection_count: rootUpdate.clientConnectionCount,
            client_connection_count_siblings: rootUpdate.clientConnectionCountSiblings,
          },
        },
        'host_state_redeemer',
      ),
      encodedConnectionRedeemer: await this.lucidService.encode(
        { ReclaimConnection: { reclaim_to: signer.hash } },
        'spendConnectionRedeemer',
      ),
      encodedMintConnectionRedeemer: await this.lucidService.encode(
        { BurnConnection: { token: connectionDatum.token, reclaim_to: signer.hash } },
        'mintConnectionRedeemer',
      ),
      encodedUpdatedHostStateDatum: await this.lucidService.encode(updatedHost, 'host_state'),
      connectionTokenUnit: tokenUnit,
      reclaimAddress,
    });
    return this.complete('reclaimConnection', request.signer, unsignedTx, validity, rootUpdate);
  }

  async beginChannelAbandonment(request: ChannelLifecycleRequest): Promise<CoreLifecycleTxResponse> {
    const signer = this.requireKeySigner(request.signer);
    const portId = this.requirePortId(request.port_id);
    const channelId = this.requireChannelId(request.channel_id);
    const validity = await this.computeValidityWindow();
    const { hostUtxo, hostDatum } = await this.resolveHost();
    this.assertHostMutable(hostDatum);
    this.assertDeployer(hostDatum, signer.hash);
    const [policyId, tokenName] = this.lucidService.getChannelTokenUnit(parseChannelSequence(channelId));
    const tokenUnit = policyId + tokenName;
    const channelUtxo = await this.requireDatumUtxo(
      await this.lucidService.findUtxoByUnit(tokenUnit),
      `channel ${channelId}`,
    );
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    this.assertChannelIdentity(channelDatum, portId, tokenUnit, channelId, channelUtxo);
    if (
      channelDatum.lifecycle !== 'ChannelActive' ||
      (channelDatum.state.channel.state !== 'Init' && channelDatum.state.channel.state !== 'TryOpen')
    ) {
      throw new GrpcFailedPreconditionException(`Channel ${portId}/${channelId} is not an active incomplete handshake`);
    }
    const notBefore = BigInt(validity.validFromTime) + LIFECYCLE_DELAY_MS;
    const updatedChannel: ChannelDatum = {
      ...channelDatum,
      lifecycle: { Abandoning: { not_before: notBefore } },
    };
    const updatedHost = this.updatedHost(hostDatum, validity, hostDatum.state.ibc_state_root);
    const unsignedTx = this.lucidService.createUnsignedBeginChannelAbandonmentTransaction({
      hostStateUtxo: hostUtxo,
      channelUtxo,
      encodedHostStateRedeemer: await this.lucidService.encode('BeginChannelAbandonment', 'host_state_redeemer'),
      encodedChannelRedeemer: await this.lucidService.encode(
        { BeginChannelAbandonment: { not_before: notBefore } },
        'spendChannelRedeemer',
      ),
      encodedUpdatedHostStateDatum: await this.lucidService.encode(updatedHost, 'host_state'),
      encodedUpdatedChannelDatum: await this.lucidService.encode(updatedChannel, 'channel'),
      channelTokenUnit: tokenUnit,
      signerKeyHash: signer.hash,
    });
    return this.completeUnchanged(
      'beginChannelAbandonment',
      request.signer,
      unsignedTx,
      validity,
      hostDatum.state.ibc_state_root,
    );
  }

  async reclaimChannel(request: ChannelLifecycleRequest): Promise<CoreLifecycleTxResponse> {
    const signer = this.requireKeySigner(request.signer);
    const portId = this.requirePortId(request.port_id);
    const channelId = this.requireChannelId(request.channel_id);
    const validity = await this.computeValidityWindow();
    const { hostUtxo, hostDatum } = await this.resolveHost();
    this.assertHostMutable(hostDatum);
    if (hostDatum.state.live_channel_count <= 0n) {
      throw new GrpcFailedPreconditionException('HostState has no live channel to reclaim');
    }
    await this.ensureTreeAligned(hostDatum.state.ibc_state_root);
    const [channelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(parseChannelSequence(channelId));
    const channelTokenUnit = channelPolicyId + channelTokenName;
    const channelUtxo = await this.requireDatumUtxo(
      await this.lucidService.findUtxoByUnit(channelTokenUnit),
      `channel ${channelId}`,
    );
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    this.assertChannelIdentity(channelDatum, portId, channelTokenUnit, channelId, channelUtxo);
    const packetStateCount =
      channelDatum.state.packet_commitment.size +
      channelDatum.state.packet_receipt.size +
      channelDatum.state.packet_acknowledgement.size;
    const abandonment = channelDatum.lifecycle === 'ChannelActive' ? undefined : channelDatum.lifecycle.Abandoning;
    const abandoned = abandonment !== undefined;
    const closedAndDrained =
      channelDatum.lifecycle === 'ChannelActive' &&
      channelDatum.state.channel.state === 'Close' &&
      packetStateCount === 0;
    const abandonedAndDrained =
      abandoned &&
      (channelDatum.state.channel.state === 'Init' || channelDatum.state.channel.state === 'TryOpen') &&
      packetStateCount === 0 &&
      abandonment !== undefined &&
      BigInt(validity.validFromTime) >= abandonment.not_before;
    if (!closedAndDrained && !abandonedAndDrained) {
      throw new GrpcFailedPreconditionException(`Channel ${portId}/${channelId} is not reclaimable`);
    }
    if (channelDatum.state.channel.connection_hops.length !== 1) {
      throw new GrpcFailedPreconditionException('Reclaimable channel must have exactly one connection hop');
    }
    const connectionId = convertHex2String(channelDatum.state.channel.connection_hops[0]);
    const [connectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      parseConnectionSequence(connectionId),
    );
    const connectionTokenUnit = connectionPolicyId + connectionTokenName;
    const connectionUtxo = await this.requireDatumUtxo(
      await this.lucidService.findUtxoByUnit(connectionTokenUnit),
      `connection ${connectionId}`,
    );
    const connectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(connectionUtxo.datum!, 'connection');
    this.assertAuthToken(connectionDatum.token, connectionTokenUnit, `connection ${connectionId}`, connectionUtxo);
    if (connectionDatum.live_channel_count <= 0n) {
      throw new GrpcFailedPreconditionException('Parent connection channel count is already zero');
    }

    const deployment = this.configService.get('deployment');
    const moduleConfig = getGatewayModuleConfigForPortId(deployment, portId);
    const registration = hostDatum.state.bound_port.get(convertString2Hex(portId));
    if (
      !registration ||
      registration.module_script_hash !== deployment.validators[moduleConfig.referenceScript].scriptHash
    ) {
      throw new GrpcFailedPreconditionException(`HostState has no matching immutable registration for port ${portId}`);
    }
    let moduleUtxo: UTxO;
    let channelLiveEscrowShardCountSiblings: string[] = [];
    if (moduleConfig.key === 'transfer') {
      const prepared = await this.packetService.prepareTransferChannelNoLiveShards(convertString2Hex(channelId));
      moduleUtxo = prepared.transferModuleUtxo;
      channelLiveEscrowShardCountSiblings = prepared.channelLiveEscrowShardCountSiblings;
    } else {
      // Mock/ICQ roots intentionally carry NoDatum; their callback validates
      // the capability-token input and redeemer and requires an exact NoDatum
      // continuation.
      moduleUtxo = await this.lucidService.findUtxoByUnit(moduleConfig.identifier);
    }
    const registeredPortUnit = registration.port_token.policy_id + registration.port_token.name;
    const registeredModuleUnit = registration.module_token.policy_id + registration.module_token.name;
    if (moduleUtxo.assets[registeredPortUnit] !== 1n || moduleUtxo.assets[registeredModuleUnit] !== 1n) {
      throw new GrpcFailedPreconditionException(
        `Module root for port ${portId} does not contain its registered capability tokens`,
      );
    }

    const { Data } = this.lucidService.LucidImporter;
    const rootUpdate = computeRootWithReclaimChannelUpdate(
      hostDatum.state.ibc_state_root,
      portId,
      channelId,
      {
        channel: Buffer.from(
          await encodeChannelEndValue(channelDatum.state.channel, this.lucidService.LucidImporter),
          'hex',
        ),
        nextSequenceSend: Buffer.from(
          Data.to(channelDatum.state.next_sequence_send as never, Data.Integer() as never),
          'hex',
        ),
        nextSequenceRecv: Buffer.from(
          Data.to(channelDatum.state.next_sequence_recv as never, Data.Integer() as never),
          'hex',
        ),
        nextSequenceAck: Buffer.from(
          Data.to(channelDatum.state.next_sequence_ack as never, Data.Integer() as never),
          'hex',
        ),
      },
      abandoned,
    );
    const updatedConnection: ConnectionDatum = {
      ...connectionDatum,
      live_channel_count: connectionDatum.live_channel_count - 1n,
    };
    const updatedHost = this.updatedHost(hostDatum, validity, rootUpdate.newRoot, {
      live_channel_count: hostDatum.state.live_channel_count - 1n,
    });
    const moduleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnChanReclaim: {
            channel_id: convertString2Hex(channelId),
            channel_live_escrow_shard_count_siblings: channelLiveEscrowShardCountSiblings,
          },
        },
      ],
    };
    const reclaimAddress = this.lucidService.credentialToAddress(signer.hash);
    const unsignedTx = this.lucidService.createUnsignedReclaimChannelTransaction({
      hostStateUtxo: hostUtxo,
      channelUtxo,
      connectionUtxo,
      moduleUtxo,
      moduleKey: moduleConfig.key,
      encodedHostStateRedeemer: await this.lucidService.encode(
        {
          ReclaimChannel: {
            reclaim_to: signer.hash,
            channel_siblings: rootUpdate.channelSiblings,
            next_sequence_send_siblings: rootUpdate.nextSequenceSendSiblings,
            next_sequence_recv_siblings: rootUpdate.nextSequenceRecvSiblings,
            next_sequence_ack_siblings: rootUpdate.nextSequenceAckSiblings,
          },
        },
        'host_state_redeemer',
      ),
      encodedChannelRedeemer: await this.lucidService.encode(
        { ReclaimChannel: { reclaim_to: signer.hash } },
        'spendChannelRedeemer',
      ),
      encodedMintChannelRedeemer: await this.lucidService.encode(
        { BurnChannel: { token: channelDatum.token, reclaim_to: signer.hash } },
        'mintChannelRedeemer',
      ),
      encodedConnectionRedeemer: await this.lucidService.encode('DecrementChannelCount', 'spendConnectionRedeemer'),
      encodedUpdatedHostStateDatum: await this.lucidService.encode(updatedHost, 'host_state'),
      encodedUpdatedConnectionDatum: await this.lucidService.encode(updatedConnection, 'connection'),
      encodedModuleRedeemer: await this.lucidService.encode(moduleRedeemer, 'iBCModuleRedeemer'),
      lifecycleMarkerTarget:
        moduleConfig.key === 'transfer'
          ? {
              port_id: convertString2Hex(portId),
              port_token: registration.port_token,
              module_token: registration.module_token,
            }
          : undefined,
      channelTokenUnit,
      connectionTokenUnit,
      reclaimAddress,
    });
    return this.complete('reclaimChannel', request.signer, unsignedTx, validity, rootUpdate);
  }

  private requireKeySigner(address: string): { hash: string } {
    if (!address?.trim()) {
      throw new GrpcInvalidArgumentException('Lifecycle transaction signer is required');
    }
    try {
      const credential = this.lucidService.getPaymentCredential(address);
      if (!credential || credential.type !== 'Key' || !/^[0-9a-fA-F]{56}$/.test(credential.hash)) {
        throw new Error('not a key credential');
      }
      return { hash: credential.hash.toLowerCase() };
    } catch {
      throw new GrpcInvalidArgumentException('Lifecycle signer must be a Cardano key-payment address');
    }
  }

  private requireClientId(value: string): string {
    try {
      parseClientSequence(value);
    } catch {
      throw new GrpcInvalidArgumentException('Invalid client_id');
    }
    return value;
  }

  private requireConnectionId(value: string): string {
    try {
      parseConnectionSequence(value);
    } catch {
      throw new GrpcInvalidArgumentException('Invalid connection_id');
    }
    return value;
  }

  private requireChannelId(value: string): string {
    try {
      parseChannelSequence(value);
    } catch {
      throw new GrpcInvalidArgumentException('Invalid channel_id');
    }
    return value;
  }

  private requirePortId(value: string): string {
    if (!value || !/^[a-z][a-z0-9._+-]{0,127}$/.test(value)) {
      throw new GrpcInvalidArgumentException('Invalid port_id');
    }
    return value;
  }

  private async resolveHost(): Promise<{ hostUtxo: UTxO; hostDatum: HostStateDatum }> {
    const hostUtxo = await this.requireDatumUtxo(await this.lucidService.findUtxoAtHostStateNFT(), 'HostState');
    return {
      hostUtxo,
      hostDatum: await this.lucidService.decodeDatum<HostStateDatum>(hostUtxo.datum!, 'host_state'),
    };
  }

  private async requireDatumUtxo(utxo: UTxO, label: string): Promise<UTxO> {
    if (!utxo.datum) {
      throw new GrpcFailedPreconditionException(`${label} UTxO has no inline datum`);
    }
    return utxo;
  }

  private assertHostMutable(hostDatum: HostStateDatum): void {
    if (hostDatum.shutdown !== 'Active' && 'Sealed' in hostDatum.shutdown) {
      throw new GrpcFailedPreconditionException('Lifecycle operations are disabled after HostState is sealed');
    }
  }

  private assertDeployer(hostDatum: HostStateDatum, signerHash: string): void {
    if (hostDatum.deployer.toLowerCase() !== signerHash.toLowerCase()) {
      throw new GrpcFailedPreconditionException('Signer does not match the HostState deployer authority');
    }
  }

  private assertAuthToken(token: { policyId: string; name: string }, unit: string, label: string, utxo: UTxO): void {
    if ((token.policyId + token.name).toLowerCase() !== unit.toLowerCase() || utxo.assets[unit] !== 1n) {
      throw new GrpcFailedPreconditionException(`${label} datum auth token does not match its UTxO`);
    }
  }

  private assertChannelIdentity(
    datum: ChannelDatum,
    portId: string,
    unit: string,
    channelId: string,
    utxo: UTxO,
  ): void {
    this.assertAuthToken(datum.token, unit, `channel ${channelId}`, utxo);
    if (convertHex2String(datum.port) !== portId) {
      throw new GrpcFailedPreconditionException(`Channel ${channelId} is not bound to port ${portId}`);
    }
  }

  private validateClientConsensusMetadata(
    datum: ClientDatum,
  ): Array<[Height, ClientDatum['state']['consensusStates'] extends Map<Height, infer V> ? V : never]> {
    const consensus = Array.from(datum.state.consensusStates.entries());
    if (consensus.length === 0) {
      throw new GrpcFailedPreconditionException('Client has no consensus state');
    }
    const consensusKeys = consensus.map(([height]) => this.heightKey(height));
    const processedTimeKeys = Array.from(datum.state.processedTimes.keys()).map((height) => this.heightKey(height));
    const processedHeightKeys = Array.from(datum.state.processedHeights.keys()).map((height) => this.heightKey(height));
    if (
      consensusKeys.join(',') !== processedTimeKeys.join(',') ||
      consensusKeys.join(',') !== processedHeightKeys.join(',') ||
      consensusKeys[0] !== this.heightKey(datum.state.clientState.latestHeight)
    ) {
      throw new GrpcFailedPreconditionException('Client consensus and delay metadata are not canonically aligned');
    }
    return consensus as any;
  }

  private assertTerminalClient(datum: ClientDatum, latestTimestamp: bigint, validFromMs: number): void {
    const frozen =
      datum.state.clientState.frozenHeight.revisionNumber !== 0n ||
      datum.state.clientState.frozenHeight.revisionHeight !== 0n;
    const expired = latestTimestamp + datum.state.clientState.trustingPeriod <= BigInt(validFromMs) * 1_000_000n;
    if (!frozen && !expired) {
      throw new GrpcFailedPreconditionException('Client is neither frozen nor expired at transaction valid-from');
    }
  }

  private heightKey(height: Height): string {
    return `${height.revisionNumber.toString()}-${height.revisionHeight.toString()}`;
  }

  private updatedHost(
    datum: HostStateDatum,
    validity: ValidityWindow,
    root: string,
    counts: Partial<HostStateDatum['state']> = {},
  ): HostStateDatum {
    const ledgerTime = BigInt(Math.trunc(validity.currentLedgerTime));
    return {
      ...datum,
      state: {
        ...datum.state,
        ...counts,
        version: datum.state.version + 1n,
        ibc_state_root: root,
        last_update_time: ledgerTime > datum.state.last_update_time ? ledgerTime : datum.state.last_update_time + 1n,
      },
    };
  }

  private async ensureTreeAligned(root: string): Promise<void> {
    if (!isTreeAligned(root)) {
      await alignTreeWithChain();
    }
    if (!isTreeAligned(root)) {
      throw new GrpcFailedPreconditionException('IBC commitment tree could not be aligned with HostState');
    }
  }

  private async computeValidityWindow(): Promise<ValidityWindow> {
    const endpoint = this.configService.get<string>('ogmiosEndpoint');
    const network = this.configService.get('cardanoNetwork') as Network;
    const slotConfig = this.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[network];
    if (!endpoint || !slotConfig || slotConfig.slotLength <= 0) {
      throw new GrpcInternalException(`Lifecycle transaction has no valid Ogmios/slot configuration for ${network}`);
    }
    return computeLedgerAnchoredValidityWindow(endpoint, slotConfig, TRANSACTION_TIME_TO_LIVE);
  }

  private async complete(
    operationName: string,
    signer: string,
    unsignedTx: TxBuilder,
    validity: ValidityWindow,
    rootUpdate: { newRoot: string; commit: () => void },
  ): Promise<CoreLifecycleTxResponse> {
    const { unsignedTxBytes } = await this.txOperationRunnerService.run({
      operationName,
      unsignedTx,
      validity: { apply: (builder) => builder.validFrom(validity.validFromTime).validTo(validity.validToTime) },
      wallet: { mode: 'refresh_from_address', address: signer, context: operationName },
      completeOptions: { localUPLCEval: false, setCollateral: TRANSACTION_SET_COLLATERAL },
      pendingTreeUpdate: { expectedNewRoot: rootUpdate.newRoot, commit: rootUpdate.commit },
    });
    this.logger.log(`Built ${operationName} transaction`);
    return { unsigned_tx: { type_url: '', value: unsignedTxBytes } };
  }

  private completeUnchanged(
    operationName: string,
    signer: string,
    unsignedTx: TxBuilder,
    validity: ValidityWindow,
    root: string,
  ): Promise<CoreLifecycleTxResponse> {
    return this.complete(operationName, signer, unsignedTx, validity, { newRoot: root, commit: () => undefined });
  }
}
