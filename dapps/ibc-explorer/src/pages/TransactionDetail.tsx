import { Suspense, lazy } from 'react';

const TransactionDetailContainer = lazy(
  () => import('@containers/TransactionDetail'),
);

const TransactionDetail = () => {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <TransactionDetailContainer />
    </Suspense>
  );
};

export default TransactionDetail;
