import routes from '@src/constants/route';
import Home from '@src/pages/Home';
import TransactionDetail from '@src/pages/TransactionDetail';

export default [
  {
    path: routes.DETAIL_TX,
    component: TransactionDetail,
    exact: false,
    restricted: true,
    isPrivate: false,
  },
  {
    path: routes.HOME,
    component: Home,
    exact: true,
    restricted: false,
    isPrivate: false,
  },
];
