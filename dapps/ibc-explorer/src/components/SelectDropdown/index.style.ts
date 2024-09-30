import styled from '@emotion/styled';
import { COLOR } from '@src/styles/color';

type StyledSelectButtonProps = {
  isActive?: boolean;
};

const StyledSelectButton = styled.button<StyledSelectButtonProps>`
  display: flex;
  height: 42px;
  padding: 10px 16px 10px 16px;
  gap: 8px;
  border-radius: 10px;
  justify-content: space-between;
  opacity: 0px;
  border: ${(props) =>
    props.isActive
      ? '1.2px solid #2767fc'
      : '1px solid rgba(233, 236, 241, 1)'};
  background-color: ${(props) => (props.isActive ? '#ebf0fd' : COLOR.white)};

  :hover {
    border: 1.2px solid #2767fc;
    background: #ebf0fd;
  }
`;

const StyledPopper = {
  width: '320px',
  height: '420px',
  padding: '16px',
  gap: '20px',
  borderRadius: '12px',
  opacity: '0px',
  background: COLOR.white,
  boxShadow: '0px 8px 24px 2px rgba(17, 20, 45, 0.09)',
};

export { StyledSelectButton, StyledPopper };
