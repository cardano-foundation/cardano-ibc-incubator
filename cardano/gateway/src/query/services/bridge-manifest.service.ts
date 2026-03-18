import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BridgeManifest } from '../../config/bridge-manifest';
import {
  QueryBridgeManifestResponse,
} from '@plus/proto-types/build/ibc/cardano/v1/query';

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
        validators: {
          ...manifest.validators,
          host_state_stt: this.toGrpcValidator(manifest.validators.host_state_stt),
          spend_handler: this.toGrpcValidator(manifest.validators.spend_handler),
          spend_client: this.toGrpcValidator(manifest.validators.spend_client),
          spend_connection: this.toGrpcValidator(manifest.validators.spend_connection),
          spend_channel: {
            ...this.toGrpcValidator(manifest.validators.spend_channel),
            ref_validator: {
              acknowledge_packet: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.acknowledge_packet),
              chan_close_confirm: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.chan_close_confirm),
              chan_close_init: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.chan_close_init),
              chan_open_ack: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.chan_open_ack),
              chan_open_confirm: this.toGrpcRefValidator(
                manifest.validators.spend_channel.ref_validator.chan_open_confirm,
              ),
              recv_packet: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.recv_packet),
              send_packet: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.send_packet),
              timeout_packet: this.toGrpcRefValidator(manifest.validators.spend_channel.ref_validator.timeout_packet),
            },
          },
          spend_transfer_module: this.toGrpcValidator(manifest.validators.spend_transfer_module),
          verify_proof: this.toGrpcValidator(manifest.validators.verify_proof),
          mint_client_stt: this.toGrpcValidator(manifest.validators.mint_client_stt),
          mint_connection_stt: this.toGrpcValidator(manifest.validators.mint_connection_stt),
          mint_channel_stt: this.toGrpcValidator(manifest.validators.mint_channel_stt),
          mint_voucher: this.toGrpcValidator(manifest.validators.mint_voucher),
        },
      },
    };
  }

  private toGrpcValidator<T extends { ref_utxo: { tx_hash: string; output_index: number } }>(validator: T) {
    return {
      ...validator,
      ref_utxo: {
        ...validator.ref_utxo,
        output_index: BigInt(validator.ref_utxo.output_index),
      },
    };
  }

  private toGrpcRefValidator<T extends { ref_utxo: { tx_hash: string; output_index: number } }>(validator: T) {
    return {
      ...validator,
      ref_utxo: {
        ...validator.ref_utxo,
        output_index: BigInt(validator.ref_utxo.output_index),
      },
    };
  }
}
