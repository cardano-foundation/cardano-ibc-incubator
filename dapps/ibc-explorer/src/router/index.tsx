import { BrowserRouter, Route, Switch } from 'react-router-dom';
import Layout from '@src/containers/Layout';
import appRoutes from './appRoutes';

const AppRouter = () => {
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
