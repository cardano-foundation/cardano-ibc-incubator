import { Box, InputBase } from '@mui/material';
import SearchIcon from '@src/assets/logo/search-normal.svg';

type SearchInputProps = {
  placeholder?: string;
  handleChangeInput?: (
    // eslint-disable-next-line no-unused-vars
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
};

export const SearchInput = ({
  placeholder,
  handleChangeInput,
}: SearchInputProps) => {
  return (
    <Box
      height="40px"
      padding="0px 16px"
      gap="10px"
      border="1px solid #E9ECF1"
      display="flex"
      borderRadius="10px"
      alignItems="center"
      justifyContent="space-between"
    >
      <InputBase
        sx={{ width: '250px' }}
        placeholder={placeholder || ''}
        onChange={(e) => (handleChangeInput ? handleChangeInput(e) : {})}
      />
      <img
        style={{ cursor: 'pointer' }}
        height={22}
        width={22}
        src={SearchIcon}
        alt="Search icon"
      />
    </Box>
  );
};
