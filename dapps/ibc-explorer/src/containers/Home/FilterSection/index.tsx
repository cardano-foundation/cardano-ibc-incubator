import { useRef, useState } from 'react';
import { DatePickerRef } from 'react-multi-date-picker';
import { Box, Button, Grid } from '@mui/material';
import ResetIcon from '@src/assets/logo/rotate-right.svg';
import { SelectDropdown } from '@src/components/SelectDropdown';
import { CustomDatePickerInput } from '@src/components/CustomDatePickerInput';
import { ChainType, StatusType } from '@src/types/transaction';
import { StatusListBox } from '@src/components/StatusListBox';
import { ChainListBox } from '@src/components/ChainListBox';
import { ChainListData } from '@src/configs/customChainInfo';

type FilterSectionProps = {
  selectedChain: ChainType | null;
  selectedStatus: StatusType;
  dateValues: any;
  setSelectedChain: React.Dispatch<React.SetStateAction<ChainType | null>>;
  setSelectedStatus: React.Dispatch<React.SetStateAction<StatusType>>;
  setDateValues: React.Dispatch<React.SetStateAction<never[]>>;
};

export const FilterSection = ({
  setSelectedChain,
  selectedChain,
  setSelectedStatus,
  selectedStatus,
  setDateValues,
  dateValues,
}: FilterSectionProps) => {
  const datePickerRef = useRef<DatePickerRef>();
  const [chainBoxAnchorEl, setChainBoxAnchorEl] = useState(null);
  const [statusBoxAnchorEl, setStatusBoxAnchorEl] = useState(null);

  const handleClick = (event: any, anchorEl: any, setAnchorEl: any) => {
    setAnchorEl(anchorEl ? null : event.currentTarget);
  };

  const handleReset = () => {
    setSelectedChain({} as ChainType);
    setSelectedStatus({} as StatusType);
    setDateValues([]);
  };

  return (
    <Box mb={2} display="flex" justifyContent="space-between">
      <Box display="flex" gap={2}>
        <Grid container spacing={2}>
          <Grid item>
            <SelectDropdown
              placeholder="From Chain"
              anchorEl={chainBoxAnchorEl}
              selectedItem={`${selectedChain?.chainName || 'All Chains'}`}
              handleClick={(e: any) => {
                handleClick(e, chainBoxAnchorEl, setChainBoxAnchorEl);
              }}
            >
              <ChainListBox
                chainList={[
                  { chainId: 'all', chainName: 'All Chains', chainLogo: '' },
                  ...ChainListData,
                ]}
                selectedChain={selectedChain}
                setSelectedChain={(transferChain: ChainType) => {
                  setSelectedChain(transferChain);
                  setChainBoxAnchorEl(null);
                }}
              />
            </SelectDropdown>
          </Grid>
          <Grid item>
            <SelectDropdown
              placeholder="All Status"
              selectedItem={selectedStatus?.label}
              anchorEl={statusBoxAnchorEl}
              handleClick={(e: any) => {
                handleClick(e, statusBoxAnchorEl, setStatusBoxAnchorEl);
              }}
            >
              <StatusListBox
                selectedStatus={selectedStatus}
                handleClick={(status: StatusType) => {
                  setSelectedStatus(status);
                  setStatusBoxAnchorEl(null);
                }}
              />
            </SelectDropdown>
          </Grid>
          <Grid item>
            <CustomDatePickerInput
              datePickerRef={datePickerRef}
              value={dateValues}
              onChange={setDateValues}
              style={{
                fontSize: '14px',
                fontWeight: '400',
                lineHeight: '20px',
              }}
            />
          </Grid>
          <Grid item>
            <Button
              color="primary"
              variant="contained"
              onClick={handleReset}
              sx={{
                borderRadius: '10px',
                padding: '9px',
                width: '42px',
                minWidth: '0px',
                boxShadow: 'none',
              }}
            >
              <img width={24} height={24} src={ResetIcon} alt="Reset" />
            </Button>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
};
