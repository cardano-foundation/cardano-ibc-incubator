import { Typography, Box } from '@mui/material';

const Relayer = () => {
  return (
    <Box flex="1">
      <Typography fontWeight={600} mb={1}>
        Relayer
      </Typography>
      <Box
        display="flex"
        height="298px"
        flexDirection="column"
        justifyContent="space-between"
      >
        <Box
          display="flex"
          flexDirection="column"
          gap={1}
          padding={2}
          bgcolor="#F5F7F9"
          borderRadius="12px"
        >
          <Typography fontSize="14px" fontWeight={700}>
            Strike Address
          </Typography>
          <Typography>--</Typography>
          <Typography fontSize="14px" fontWeight={700}>
            Source Address
          </Typography>
          <Typography>--</Typography>
        </Box>

        <Box>
          <Typography fontWeight={600} mb={1}>
            Dest Address
          </Typography>
          <Box
            display="flex"
            flexDirection="column"
            gap={1}
            padding={2}
            bgcolor="#f7f9fc"
            borderRadius="12px"
          >
            <Typography fontSize="14px" fontWeight={700}>
              Number
            </Typography>
            <Typography>2740</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default Relayer;
