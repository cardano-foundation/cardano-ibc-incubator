use ibc/client/cardano_client/height
use ibc/client/cardano_client/protos/cardano_pb.{CardanoClientState}

pub fn validate_self_client(cardano_client: CardanoClientState) -> Bool {
  expect Some(frozen_height) = cardano_client.frozen_height
  expect height.is_zero(frozen_height)
  True
}
