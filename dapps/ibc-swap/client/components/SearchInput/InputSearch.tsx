import { InputLeftElement } from '@chakra-ui/react';
import { IoSearchOutline } from 'react-icons/io5';
import { COLOR } from '@/styles/color';
import { StyledSearchInput, StyledSearchInputGroup } from './index.style';

type SearchInputProps = {
  placeholder: string;
  // eslint-disable-next-line no-unused-vars
  onChange?: (event: any) => void;
};

export const SearchInput = ({ placeholder, onChange }: SearchInputProps) => {
  return (
    <StyledSearchInputGroup>
      <InputLeftElement pointerEvents="none">
        <IoSearchOutline color={COLOR.neutral_1} />
      </InputLeftElement>
      <StyledSearchInput placeholder={placeholder} onChange={onChange} />
    </StyledSearchInputGroup>
  );
};
