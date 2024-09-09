import { Box } from '@mui/material';
import { HeaderTitle } from '@src/components/HeaderTitle';
import { useEffect, useState } from 'react';

import {
  ChainType,
  StatusType,
  TokenType,
  TransactionType,
} from '@src/types/transaction';
import { getListTxs } from '@src/services/transaction';
import { ROW_PER_PAGE } from '@src/constants';
import { FilterSection } from './FilterSection';
import { TableSection } from './TableSection';

import { StyledWrapperCointainer } from './index.style';

const App = () => {
  const [txList, setTxList] = useState<TransactionType[]>([]);
  const [selectedToken] = useState<TokenType>({} as TokenType);
  const [selectedChains, setSelectedChains] = useState<{
    transferChain: ChainType | null;
    receiveChain: ChainType | null;
  }>({ transferChain: null, receiveChain: null });
  const [selectedStatus, setSelectedStatus] = useState<StatusType>(
    {} as StatusType,
  );
  const [dateValues, setDateValues] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    rowsPerPage: 10,
    count: 1,
  });

  const fetchCount = () => {
    const response = getListTxs({
      pagination: {
        page: 1,
        rowsPerPage: ROW_PER_PAGE,
      },
      filterToken: selectedToken.tokenDenom,
      filterChains: {
        fromChain: selectedChains.transferChain?.chainName,
        toChain: selectedChains.receiveChain?.chainName,
      },
      filterStatus: selectedStatus.value,
      filterDate: dateValues.join(','),
    });
    setPagination({
      page: 1,
      rowsPerPage: ROW_PER_PAGE,
      count: Math.ceil(response.total / ROW_PER_PAGE),
    });
  };

  useEffect(() => {
    fetchCount();
  }, [selectedToken, selectedChains, selectedStatus, dateValues]);

  useEffect(() => {
    const fetchListTxs = () => {
      const response = getListTxs({
        pagination: {
          page: pagination.page,
          rowsPerPage: ROW_PER_PAGE,
        },
        filterToken: selectedToken.tokenDenom,
        filterChains: {
          fromChain: selectedChains.transferChain?.chainName,
          toChain: selectedChains.receiveChain?.chainName,
        },
        filterStatus: selectedStatus.value,
        filterDate: dateValues.join(','),
      });
      setTxList(response.data);
    };
    fetchListTxs();
  }, [pagination]);

  return (
    <Box margin="auto" maxWidth={1200} p="32px 24px">
      <StyledWrapperCointainer>
        <HeaderTitle title="IBC Packet" />
        <FilterSection
          selectedChains={selectedChains}
          selectedStatus={selectedStatus}
          dateValues={dateValues}
          setSelectedChains={setSelectedChains}
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
