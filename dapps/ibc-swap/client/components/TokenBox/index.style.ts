import styled from '@emotion/styled';

const StyledTokenBox = styled.div`
  width: 100%;
  height: 108px;
  padding: 16px 16px 20px 16px;
  border-radius: 11px;
  opacity: 0px;
  background: #323236;
  margin-top: 20px;

  .label {
    font-size: 14px;
    color: #9a9a9e;
  }

  .balance {
    font-size: 14px;
    color: #a8a8a9;
    font-weight: 600;
  }

  .input-quantity {
    border: none;
    color: white;
    font-weight: 700;
    font-size: 32px;
    max-width: 200px;
  }
`;

export default StyledTokenBox;
