import { gql } from '@apollo/client';

export const GET_CARDANO_IBC_ASSETS = gql`
  query CardanoIbcAssets {
    cardanoIbcAssets {
      nodes {
        id
        accountAddress
        denom
        voucherTokenName
        connectionId
        srcPort
        dstChannel
        dstPort
        dstChannel
        path
      }
    }
  }
`;

export const GET_CARDANO_DENOM_BY_ID = gql`
  query CardanoIbcAsset($id: String!) {
    cardanoIbcAsset(id: $id) {
      denom
      path
    }
  }
`;
