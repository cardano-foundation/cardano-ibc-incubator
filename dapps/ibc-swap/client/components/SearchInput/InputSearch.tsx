import { InputLeftElement } from '@chakra-ui/react';
import { IoSearchOutline } from 'react-icons/io5';
import { COLOR } from '@/styles/color';
import { CustomSearchInput, CustomSearchInputGroup } from './index.styled';

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
