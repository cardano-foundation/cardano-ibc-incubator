import { Suspense, lazy } from 'react';

const HomeContainer = lazy(() => import('@containers/Home'));

const Home = () => {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeContainer />
    </Suspense>
  );
};

export default Home;
