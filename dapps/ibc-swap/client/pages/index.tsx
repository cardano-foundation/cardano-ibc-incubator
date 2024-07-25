import type { NextPage } from 'next';
import { CardanoWallet } from '@meshsdk/react';
import SendToken from '@/containers/SendToken';

const Home: NextPage = () => {
  return (
    <div>
      <h1>Connect Wallet</h1>
      <CardanoWallet />
      <SendToken />
    </div>
  );
};

export default Home;
