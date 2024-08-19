import { GET_CARDANO_IBC_ASSETS } from '@/apis/apollo/query';
import { useQuery } from '@apollo/client';
import SendToken from '@/containers/SendToken';

interface Node {
  id: string;
  accountAddress: string;
  denom: string;
  voucherTokenName: string;
}

interface CardanoIbcAssets {
  cardanoIbcAssets: {
    node: Node;
  };
}

export default function TestComponent() {
  const { loading, error, data } = useQuery<CardanoIbcAssets>(
    GET_CARDANO_IBC_ASSETS,
  );

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <div>
      <SendToken />
      <h1>Data from GraphQL:</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
