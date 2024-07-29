import { InputLeftElement } from '@chakra-ui/react';
import { IoSearchOutline } from 'react-icons/io5';
import { CustomSearchInput, CustomSearchInputGroup } from './index.styled';
import { COLOR } from '@/styles/color';

export const SearchInput = () => {
  return (
    <CustomSearchInputGroup>
      <InputLeftElement pointerEvents="none">
        <IoSearchOutline color={COLOR.neutral_1} />
      </InputLeftElement>
      <CustomSearchInput placeholder="Search network" />
    </CustomSearchInputGroup>
  );
};
