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
    },
  },
});
