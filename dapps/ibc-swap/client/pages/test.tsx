import {
  listCardanoIbcAssets,
  type CardanoAssetDenomTrace,
} from '@/apis/restapi/cardano';
import SendToken from '@/containers/SendToken';
import { useEffect, useState } from 'react';

export default function TestComponent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<CardanoAssetDenomTrace[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await listCardanoIbcAssets();
        setData(response);
      } catch (err) {
        setError((err as Error).message || 'Failed to load Cardano IBC assets');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <div>
      <SendToken />
      <h1>Data from Cardano trace registry:</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
