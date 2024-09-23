import styled from '@emotion/styled';
import { COLOR } from '@src/styles/color';

const StyledDateRangePickerButton = styled.div`
  display: flex;
  gap: 0px;
  padding: 1px 16px;
  border-radius: 10px;
  justify-content: space-between;
  opacity: 0px;
  border: 1px solid rgba(233, 236, 241, 1);
  background-color: ${COLOR.white};
  justify-content: space-between;
  align-items: center;

  :hover {
    border: 1.2px solid #2767fc;
  }

  .date-picker-input {
    padding: 0px;
    height: 38px;
    border: none;
    font-size: 16px;
    outline: none !important;
    cursor: pointer;

    :focus {
      border: none;
    }

    :focus-visible {
      border: none !important;
      outline: none !important;
    }
  }
`;

export { StyledDateRangePickerButton };
