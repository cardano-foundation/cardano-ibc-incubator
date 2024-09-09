import styled from '@emotion/styled';
import { Box } from '@mui/material';

const StyledWrapperCointainer = styled.div`
  max-width: 1200px;
  display: inline-block;
  gap: 24px;
  opacity: 0px;
  margin-bottom: 20px;
  width: 100%;

  @media (max-width: 768px) {
    padding: 10px 20px;
  }
`;

const StyledBasicInfo = styled(Box)`
  background-color: #ffffff;
  padding: 20px 24px 22px 24px;
  border-radius: 12px;
`;

export { StyledWrapperCointainer, StyledBasicInfo };
