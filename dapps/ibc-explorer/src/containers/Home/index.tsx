import { Box } from '@mui/material';
import apolloClient from '@src/apis/apollo';
import { HeaderTitle } from '@src/components/HeaderTitle';
import { useEffect, useState } from 'react';

import { ChainType, StatusType, TransactionType } from '@src/types/transaction';
import { ROW_PER_PAGE } from '@src/constants';
import { DateObject } from 'react-multi-date-picker';
import { GET_PACKET_FLOWS } from '@src/apis/query';
import { debounce } from '@src/utils/helper';

import { FilterSection } from './FilterSection';
import { TableSection } from './TableSection';

import { StyledWrapperCointainer } from './index.style';

const App = () => {
  const [txList, setTxList] = useState<TransactionType[]>([]);
  const [selectedChain, setSelectedChain] = useState<ChainType | null>(
    {} as ChainType,
  );
  const [selectedStatus, setSelectedStatus] = useState<StatusType>(
    {} as StatusType,
  );
  const [dateValues, setDateValues] = useState<DateObject[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    rowsPerPage: ROW_PER_PAGE,
    count: 1,
  });

  const buildQuery = () => {
    const queryFilter: any = {
      createTime: {
        greaterThanOrEqualTo: '0',
      },
    };
    if (
      selectedChain &&
      selectedChain.chainId &&
      selectedChain.chainId !== 'all'
    ) {
      queryFilter.fromChainId = {
        equalTo: selectedChain.chainId,
      };
    }
    if (selectedStatus && selectedStatus.value && selectedStatus.value !== '') {
      queryFilter.status = {
        equalTo: selectedStatus.value,
      };
    }
    if (dateValues.length > 0) {
      const [startDate, endDate] = dateValues;
      queryFilter.createTime = {
        greaterThanOrEqualTo: (startDate.toUnix() * 1000).toString(),
      };
      if (endDate) {
        queryFilter.createTime.lessThanOrEqualTo = (
          endDate.add(1, 'day').toUnix() * 1000
        ).toString();
      }
    }
    return queryFilter;
  };
  const getPacketFlow = debounce(async () => {
    const query = buildQuery();
    const offset = pagination.rowsPerPage * (pagination.page - 1);
    const packetFlows = await apolloClient
      .query({
        query: GET_PACKET_FLOWS,
        variables: {
          queryFilter: query,
          first: pagination.rowsPerPage,
          offset,
        },
        fetchPolicy: 'network-only',
      })
      .then((res) => res.data.packetFlows)
      .catch(() => ({
        nodes: [],
        count: 0,
      }));
    setTxList(packetFlows.nodes);
    setPagination((prev) => ({
      ...prev,
      count: Math.ceil(packetFlows.totalCount / ROW_PER_PAGE),
    }));
  }, 500);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [
    JSON.stringify(selectedChain),
    JSON.stringify(selectedStatus),
    JSON.stringify(dateValues),
  ]);

  useEffect(() => {
    getPacketFlow();
  }, [
    JSON.stringify(selectedChain),
    JSON.stringify(selectedStatus),
    JSON.stringify(dateValues),
    pagination.page,
  ]);

  useEffect(() => {
    // first call
    getPacketFlow();
  }, []);

  return (
    <Box margin="auto" maxWidth={1200} p="32px 24px">
      <StyledWrapperCointainer>
        <HeaderTitle title="IBC Packet" />
        <FilterSection
          selectedChain={selectedChain}
          selectedStatus={selectedStatus}
          dateValues={dateValues}
          setSelectedChain={setSelectedChain}
          setSelectedStatus={setSelectedStatus}
          setDateValues={setDateValues}
        />
        <TableSection
          data={txList}
          pagination={pagination}
          setPagination={setPagination}
        />
      </StyledWrapperCointainer>
    </Box>
  );
};

export default App;
