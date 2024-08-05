import { Box } from '@chakra-ui/react';
import styled from '@emotion/styled';

const StyledSwap = styled.div`
  width: 484px;
  background: #26262a;
  color: white;
  padding: 20px;
  border-radius: 10px;
  margin: 100px auto;

  .title {
    color: padding;
    font-size: 20px;
  }

  .swap-button {
    width: 100%;
    background-color: #47474b;
    margin-top: 20px;
    color: #a8a8a9;
  }

  .destination-address {
    background: #323236;
    border: none;
    margin-top: 15px;
  }
`;

export const StyledSwitchNetwork = styled(Box)`
  width: 36px;
  height: 36px;
  padding: 8px;
  gap: 10px;
  border-radius: 8px;
  border-width: 1px;
  opacity: 0px;
  background: #26262a;
  border: 1px solid #47474b;
  box-shadow: 0px 0px 8px 0px #00000040;
  cursor: pointer;
  position: absolute;
  margin-top: 10px;
  left: 50%;
  translate: -50% -50%;
  transform: rotate(90deg);
`;

export default StyledSwap;
