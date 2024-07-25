import { Transaction } from '@meshsdk/core';
import { useWallet } from '@meshsdk/react';
import React, { useState } from 'react';

const SendToken = () => {
  const { connected, wallet } = useWallet();
  const [formData, setFormData] = useState({ address: '', amount: '' });
  const [transactioSuccessMsg, setTransactionSuccessMsg] = useState('');

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
            style={{ height: '40px' }}
            value={formData.address}
            onChange={handleChangeAddress}
          />
          <input
            placeholder="Amount in Lovelace"
            style={{ height: '40px' }}
            value={formData.amount}
            onChange={handleChangeAmount}
          />
          <button
            onClick={handleSendToken}
            style={{ height: '40px', width: '100px' }}
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
