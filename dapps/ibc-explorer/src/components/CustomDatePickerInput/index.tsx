import { Box, useMediaQuery, useTheme } from '@mui/material';
import DatePicker from 'react-multi-date-picker';
import CalendarIcon from '@src/assets/logo/calendar.svg';

import { StyledDateRangePickerButton } from './index.style';

export const CustomDatePickerInput = ({ datePickerRef, ...props }: any) => {
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <StyledDateRangePickerButton>
      <DatePicker
        placeholder="Start Date - End Date"
        arrow={false}
        range
        inputClass="date-picker-input"
        ref={datePickerRef}
        editable={false}
        numberOfMonths={matches ? 1 : 2}
        dateSeparator=" - "
        offsetY={4}
        {...props}
      />
      <Box
        style={{ cursor: 'pointer' }}
        onClick={() => {
          return datePickerRef.current?.isOpen
            ? datePickerRef.current?.closeCalendar()
            : datePickerRef.current?.openCalendar();
        }}
      >
        <img src={CalendarIcon} alt="calendar" />
      </Box>
    </StyledDateRangePickerButton>
  );
};
