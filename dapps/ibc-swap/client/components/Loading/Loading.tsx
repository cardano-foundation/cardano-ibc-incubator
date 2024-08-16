import { COLOR } from '@/styles/color';
import { Box, Spinner } from '@chakra-ui/react';

export const Loading = () => {
  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      height="100%"
      width="100%"
      margin="auto"
      opacity={0.8}
    >
      <Spinner size="lg" color={COLOR.info} thickness="2px" />
    </Box>
  );
};
