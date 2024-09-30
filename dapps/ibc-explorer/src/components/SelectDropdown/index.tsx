import { Box, ClickAwayListener, Popper, Typography } from '@mui/material';
import { ReactNode } from 'react';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

import { StyledSelectButton } from './index.style';

type SelectDropdownProps = {
  placeholder: string;
  anchorEl: any;
  handleClick: any;
  selectedItem?: string | undefined;
  children: ReactNode;
};

export const SelectDropdown = ({
  placeholder,
  anchorEl,
  handleClick,
  selectedItem,
  children,
}: SelectDropdownProps) => {
  const open = Boolean(anchorEl);

  return (
    <>
      <StyledSelectButton onClick={handleClick} isActive={open}>
        <Typography fontSize={14} fontWeight={400} lineHeight="20px">
          {selectedItem ?? placeholder}
        </Typography>
        {open ? (
          <KeyboardArrowUpIcon style={{ width: '22px', height: '22px' }} />
        ) : (
          <KeyboardArrowDownIcon style={{ width: '22px', height: '22px' }} />
        )}
      </StyledSelectButton>
      <Popper
        placement="bottom-start"
        open={open}
        disablePortal
        anchorEl={anchorEl}
        sx={{ zIndex: 1 }}
      >
        <ClickAwayListener onClickAway={handleClick}>
          <Box>{children}</Box>
        </ClickAwayListener>
      </Popper>
    </>
  );
};
