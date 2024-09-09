import { TxListData } from '@src/containers/Home/fakeData';
import { unixTimestampToDate } from '@src/utils/string';

type getListTxsProps = {
  pagination: {
    page: number;
    rowsPerPage: number;
  };
  filterToken: string | undefined;
  filterChains: {
    fromChain: string | undefined;
    toChain: string | undefined;
  };
  filterStatus: string | undefined;
  filterDate: string | undefined;
};

const getListTxs = ({
  pagination,
  filterToken,
  filterChains,
  filterStatus,
  filterDate,
}: getListTxsProps) => {
  const rawData = TxListData;
  let responseData = rawData;

  if (filterStatus) {
    responseData = responseData.filter(
      (data) => data.status.toLowerCase() === filterStatus.toLowerCase(),
    );
  }
  if (filterToken && filterToken !== 'All Token') {
    responseData = responseData.filter(
      (data) =>
        data.token.tokenDenom.toLowerCase() === filterToken.toLowerCase(),
    );
  }
  if (filterChains.fromChain && filterChains.fromChain !== 'All Chains') {
    responseData = responseData.filter(
      (data) =>
        data.fromNetwork.networkName.toLowerCase() ===
        filterChains.fromChain?.toLowerCase(),
    );
  }
  if (filterChains.toChain && filterChains.toChain !== 'All Chains') {
    responseData = responseData.filter(
      (data) =>
        data.toNetwork.networkName.toLowerCase() ===
        filterChains.toChain?.toLowerCase(),
    );
  }
  if (filterDate) {
    const filterDates = filterDate.split(',');
    if (filterDates?.[0]) {
      responseData = responseData.filter(
        (data) =>
          unixTimestampToDate(data.createTime) >= new Date(filterDates[0]),
      );
    }
    if (filterDates?.[1]) {
      const inputDate = new Date(filterDates[1]);
      const nextDay = new Date(inputDate);
      nextDay.setDate(inputDate.getDate() + 1);
      responseData = responseData.filter(
        (data) => unixTimestampToDate(data.endTime) <= nextDay,
      );
    }
  }

  const startIndex = (pagination.page - 1) * pagination.rowsPerPage;
  const endIndex =
    startIndex + pagination.rowsPerPage < responseData.length
      ? startIndex + pagination.rowsPerPage
      : responseData.length;

  const data = responseData.slice(startIndex, endIndex);

  return { data, total: responseData.length };
};

export { getListTxs };
