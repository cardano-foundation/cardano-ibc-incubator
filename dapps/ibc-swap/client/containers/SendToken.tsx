/* eslint-disable no-console */
import { Transaction } from '@meshsdk/core';
import { CardanoWallet, useWallet } from '@meshsdk/react';
import React, { useState } from 'react';
import * as CSL from '@emurgo/cardano-serialization-lib-browser';
import { getPublicKeyHashFromAddress } from '@/utils/address';

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
    const tx1 = CSL.Transaction.from_hex(unsignedTx);
    console.log(tx1.body().fee().to_str());
    console.log({ hash: getPublicKeyHashFromAddress(address) });

    const signedTx = await wallet.signTx(unsignedTx, true);
    console.log({ signedTx });

    const txHash = await wallet.submitTx(signedTx);
    console.log({ txHash });

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
