import { useEffect } from 'react';
import { BrowserRouter, Route, Switch } from 'react-router-dom';
import nprogress from 'nprogress';
import 'nprogress/nprogress.css';
import Layout from '@src/containers/Layout';
import appRoutes from './appRoutes';

const AppRouter = () => {
  if (!nprogress.isStarted()) nprogress.start();

  useEffect(() => {
    nprogress.done();
  });

  return (
    <BrowserRouter>
      <Switch>
        <Layout>
          {appRoutes.map((route) => (
            <Route
              exact
              path={route.path}
              component={route.component}
              key={route.path}
            />
          ))}
        </Layout>
      </Switch>
    </BrowserRouter>
  );
};

export default AppRouter;
