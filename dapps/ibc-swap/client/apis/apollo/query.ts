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
