import { QueryBridgeManifestResponse } from '@cardano-ibc/proto-types/build/ibc/cardano/v1/query';
import { ConfigService } from '@nestjs/config';

import { BridgeManifest, ICS20_PACKET_CODEC } from '../../config/bridge-manifest';
import { BridgeManifestService } from './bridge-manifest.service';

function validator(name: string, outputIndex = 1) {
  return {
    script_hash: `${name}-hash`,
    address: `${name}-address`,
    ref_utxo: {
      tx_hash: `${name}-tx`,
      output_index: outputIndex,
    },
  };
}

function manifest(): BridgeManifest {
  const channel = validator('channel');
  const referredValidator = (name: string) => ({
    script_hash: `${name}-hash`,
    ref_utxo: { tx_hash: `${name}-tx`, output_index: 1 },
  });

  return {
    schema_version: 4,
    deployment_id: 'cardano-devnet:host-policy.host-token',
    deployed_at: '2026-04-01T12:34:56.000Z',
    ics20_packet_codec: ICS20_PACKET_CODEC.STRICT,
    cardano: { chain_id: 'cardano-devnet', network_magic: 42, network: 'Custom' },
    host_state_nft: { policy_id: 'host-policy', token_name: 'host-token' },
    validators: {
      host_state_stt: validator('host'),
      recover_client: validator('recover', 12),
      spend_client: validator('client'),
      spend_connection: validator('connection'),
      spend_channel: {
        ...channel,
        ref_validator: {
          acknowledge_packet: referredValidator('ack'),
          chan_close_confirm: referredValidator('close-confirm'),
          chan_close_init: referredValidator('close-init'),
          chan_open_ack: referredValidator('open-ack'),
          chan_open_confirm: referredValidator('open-confirm'),
          recv_packet: referredValidator('recv'),
          prune_packet_history: referredValidator('prune'),
          send_packet: referredValidator('send'),
          timeout_packet: referredValidator('timeout'),
        },
      },
      spend_transfer_module: validator('transfer'),
      mint_identifier: validator('identifier'),
      verify_proof: validator('proof'),
      mint_client_stt: validator('mint-client'),
      mint_connection_stt: validator('mint-connection'),
      mint_channel_stt: validator('mint-channel'),
      mint_voucher: validator('voucher'),
      mint_transfer_escrow_shard: validator('escrow-shard'),
      mint_port: validator('port'),
    },
    modules: {
      transfer: { identifier: 'transfer', address: 'transfer-address' },
    },
  };
}

describe('BridgeManifestService', () => {
  it('includes the recovery validator in the encoded gRPC manifest', () => {
    const bridgeManifest = manifest();
    const configService = {
      get: jest.fn().mockReturnValue(bridgeManifest),
    } as unknown as ConfigService;
    const response = new BridgeManifestService(configService).getGrpcBridgeManifestResponse();

    expect(response.manifest?.validators?.recover_client?.ref_utxo?.output_index).toBe(12n);

    const decoded = QueryBridgeManifestResponse.decode(QueryBridgeManifestResponse.encode(response).finish());
    expect(decoded.manifest?.validators?.recover_client).toEqual({
      script_hash: 'recover-hash',
      address: 'recover-address',
      ref_utxo: { tx_hash: 'recover-tx', output_index: 12n },
    });
  });
});
