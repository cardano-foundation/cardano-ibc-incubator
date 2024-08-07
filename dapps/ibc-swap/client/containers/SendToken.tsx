import { Transaction, BrowserWallet } from '@meshsdk/core';
import { CardanoWallet, useWallet } from '@meshsdk/react';
import React, { useEffect, useState } from 'react';

const SendToken = () => {
  const { connected, wallet } = useWallet();
  const [formData, setFormData] = useState({ address: '', amount: '' });
  const [transactioSuccessMsg, setTransactionSuccessMsg] = useState('');

  useEffect(() => {
    const getListWallet = async () => {
      const wallets = await BrowserWallet.getInstalledWallets();
    };
    getListWallet();
  }, []);

  async function handleSendToken() {
    const { address, amount } = formData;
    const tx = new Transaction({ initiator: wallet }).sendLovelace(
      address,
      amount,
    );
    const unsignedTx = await tx.build();
    const signedTx = await wallet.signTx(unsignedTx);
    const txHash = await wallet.submitTx(signedTx);

    if (txHash) {
      setFormData({ ...formData, address: '', amount: '' });
      setTransactionSuccessMsg(
        `Send token successfully. Transaction Hash: ${txHash}`,
      );
    }
  }

  async function handleChangeAddress(e: any) {
    setFormData({ ...formData, address: e.target.value });
  }

  async function handleChangeAmount(e: any) {
    setFormData({ ...formData, amount: e.target.value });
  }

  return (
    <>
      <CardanoWallet />
      {connected && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '500px',
            gap: '10px',
            marginTop: '10px',
          }}
        >
          <input
            placeholder="Address"
            style={{ height: '40px', color: 'black' }}
            value={formData.address}
            onChange={handleChangeAddress}
          />
          <input
            placeholder="Amount in Lovelace"
            style={{ height: '40px', color: 'black' }}
            value={formData.amount}
            onChange={handleChangeAmount}
          />
          <button
            type="button"
            onClick={handleSendToken}
            style={{
              height: '40px',
              width: '100px',
              background: 'white',
              color: 'black',
            }}
          >
            Send token
          </button>
          {transactioSuccessMsg && <p>{transactioSuccessMsg}</p>}
        </div>
      )}
    </>
  );
};

export default SendToken;
