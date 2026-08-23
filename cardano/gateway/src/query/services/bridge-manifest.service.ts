import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BridgeManifest } from '../../config/bridge-manifest';
import { QueryBridgeManifestResponse } from '@cardano-ibc/proto-types/build/ibc/cardano/v1/query';

@Injectable()
export class BridgeManifestService {
  constructor(private readonly configService: ConfigService) {}

  getBridgeManifest(): BridgeManifest {
    // AppModule loads and validates the manifest during startup, so this getter
    // is just the single runtime access point for REST and gRPC handlers.
    const bridgeManifest = this.configService.get<BridgeManifest>('bridgeManifest');

    if (!bridgeManifest) {
      throw new Error('Bridge manifest is not loaded');
    }

    return bridgeManifest;
  }

  getGrpcBridgeManifestResponse(): QueryBridgeManifestResponse {
    const manifest = this.getBridgeManifest();

    // Protobuf uint64 fields are generated as bigint in TypeScript, so the JSON
    // manifest needs a small shape conversion before it can be returned over gRPC.
    return {
      manifest: {
        ...manifest,
        cardano: {
          ...manifest.cardano,
          network_magic: BigInt(manifest.cardano.network_magic),
        },
        reference_out_refs: manifest.reference_out_refs.map((refUtxo) => this.toGrpcRefUtxo(refUtxo)),
        validators: {
          host_state_stt: this.toGrpcValidator(manifest.validators.host_state_stt),
          spend_client: this.toGrpcValidator(manifest.validators.spend_client),
          spend_connection: this.toGrpcValidator(manifest.validators.spend_connection),
          spend_channel: {
            ...this.toGrpcValidator(manifest.validators.spend_channel),
            ref_validator: {
              acknowledge_packet: this.toGrpcRefValidator(
                manifest.validators.spend_channel.ref_validator.acknowledge_packet,
              ),
              chan_close_confirm: this.toGrpcRefValidator(
                manifest.validators.spend_channel.ref_validator.chan_close_confirm,
              ),
              chan_close_init: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.chan_close_init),
              chan_open_ack: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.chan_open_ack),
              chan_open_confirm: this.toGrpcRefValidator(
                manifest.validators.spend_channel.ref_validator.chan_open_confirm,
              ),
              recv_packet: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.recv_packet),
              prune_packet_history: this.toGrpcRefValidator(
                manifest.validators.spend_channel.ref_validator.prune_packet_history,
              ),
              send_packet: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.send_packet),
              timeout_packet: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.timeout_packet),
            },
          },
          ...(manifest.validators.spend_mock_module
            ? { spend_mock_module: this.toGrpcValidator(manifest.validators.spend_mock_module) }
            : {}),
          ...(manifest.validators.spend_trace_registry
            ? { spend_trace_registry: this.toGrpcValidator(manifest.validators.spend_trace_registry) }
            : {}),
          spend_transfer_module: this.toGrpcValidator(manifest.validators.spend_transfer_module),
          mint_identifier: this.toGrpcValidator(manifest.validators.mint_identifier),
          verify_proof: this.toGrpcValidator(manifest.validators.verify_proof),
          mint_client_stt: this.toGrpcValidator(manifest.validators.mint_client_stt),
          mint_connection_stt: this.toGrpcValidator(manifest.validators.mint_connection_stt),
          mint_channel_stt: this.toGrpcValidator(manifest.validators.mint_channel_stt),
          mint_voucher: this.toGrpcValidator(manifest.validators.mint_voucher),
          mint_lifecycle_creation_marker: this.toGrpcValidator(manifest.validators.mint_lifecycle_creation_marker),
          mint_lifecycle_reclamation_marker: this.toGrpcValidator(
            manifest.validators.mint_lifecycle_reclamation_marker,
          ),
          mint_lifecycle_operational_marker: this.toGrpcValidator(
            manifest.validators.mint_lifecycle_operational_marker,
          ),
          mint_lifecycle_packet_marker: this.toGrpcValidator(manifest.validators.mint_lifecycle_packet_marker),
          mint_transfer_escrow_shard: this.toGrpcValidator(manifest.validators.mint_transfer_escrow_shard),
          mint_port: this.toGrpcValidator(manifest.validators.mint_port),
          ...(manifest.validators.mint_trace_registry_benchmark_voucher
            ? {
                mint_trace_registry_benchmark_voucher: this.toGrpcValidator(
                  manifest.validators.mint_trace_registry_benchmark_voucher,
                ),
              }
            : {}),
          ...(manifest.validators.voucher_metadata ? { voucher_metadata: manifest.validators.voucher_metadata } : {}),
        },
      },
    };
  }

  private toGrpcValidator<T extends { ref_utxo: { tx_hash: string; output_index: number } }>(validator: T) {
    return {
      ...validator,
      ref_utxo: this.toGrpcRefUtxo(validator.ref_utxo),
    };
  }

  private toGrpcRefValidator<T extends { ref_utxo: { tx_hash: string; output_index: number } }>(validator: T) {
    return {
      ...validator,
      ref_utxo: this.toGrpcRefUtxo(validator.ref_utxo),
    };
  }

  private toGrpcRefUtxo<T extends { tx_hash: string; output_index: number }>(refUtxo: T) {
    return {
      ...refUtxo,
      output_index: BigInt(refUtxo.output_index),
    };
  }
}
