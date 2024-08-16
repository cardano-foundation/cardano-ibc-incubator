import { extendTheme } from '@chakra-ui/react';
import { COLOR } from './color';

export const theme = extendTheme({
  styles: {
    global: {
      'html, body': {
        height: '100%',
        backgroundColor: COLOR.background,
        color: COLOR.neutral_1,
      },

      '::-webkit-scrollbar': {
        width: '4px',
      },
      '::-webkit-scrollbar-track': {
        background: COLOR.neutral_6,
      },

      '::-webkit-scrollbar-thumb': {
        background: COLOR.neutral_5,
        borderRadius: '2px',
      },

      /* Handle on hover */
      '::-webkit-scrollbar-thumb:hover': {
        background: COLOR.neutral_4,
      },
    },
  },
});
