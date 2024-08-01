import styled from '@emotion/styled';
import { COLOR } from '@/styles/color';
import { BoxProps } from '@chakra-ui/react';
import { Box } from '@interchain-ui/react';

interface StyledNetworkBoxProps extends BoxProps {
  isChoseToken?: boolean;
}

const StyledNetworkBox = styled(Box)<StyledNetworkBoxProps>`
  width: 984px;
  height: 100%;
  gap: 16px;
  border-radius: 12px;
  opacity: 0px;
  background: #0e0e124d;
  border: ${(props) => !props.isChoseToken && `1px solid #fd4c80`};
`;

const StyledNetworkBoxHeader = styled(Box)<StyledNetworkBoxProps>`
  width: 100%;
  height: 56px;
  padding: 14px 12px 14px 12px;
  gap: 16px;
  border-radius: 12px 12px 0px 0px;
  opacity: 0px;
  background: ${COLOR.neutral_5};
  display: flex;
  justify-content: center;
  background: ${(props) => !props.isChoseToken && `#fd4c8014`}; ;
`;

const StyledTokenBox = styled.div`
  width: 984px;
  height: 100%;
  padding: 0px 0px 16px 0px;
  gap: 30px;
  opacity: 0px;
`;

export { StyledNetworkBox, StyledNetworkBoxHeader, StyledTokenBox };
