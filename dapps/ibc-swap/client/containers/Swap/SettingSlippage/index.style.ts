import styled from '@emotion/styled';

const StyledSettingSlippage = styled.div`
  cursor: pointer;
  .chakra-popover__popper {
    transform: translate3d(830px, 236px, 0px) !important;
  }

  .chakra-numberinput {
    border-radius: 10px;
    input {
      border: none;
    }
  }

  .percent {
    position: relative;
    left: -50px;
    display: flex;
    align-items: center;
  }
`;

export default StyledSettingSlippage;
