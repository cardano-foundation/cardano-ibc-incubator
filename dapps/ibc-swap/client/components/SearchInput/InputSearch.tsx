import { InputLeftElement } from '@chakra-ui/react';
import { IoSearchOutline } from 'react-icons/io5';
import { COLOR } from '@/styles/color';
import { StyledSearchInput, StyledSearchInputGroup } from './index.style';

export const SearchInput = () => {
  return (
    <StyledSearchInputGroup>
      <InputLeftElement pointerEvents="none">
        <IoSearchOutline color={COLOR.neutral_1} />
      </InputLeftElement>
      <StyledSearchInput placeholder="Search network" />
    </StyledSearchInputGroup>
  );
};
