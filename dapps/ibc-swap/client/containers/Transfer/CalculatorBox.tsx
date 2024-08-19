import { Box, Img, Skeleton, Text, Tooltip } from '@chakra-ui/react';
import InfoIcon from '@/assets/icons/info.svg';
import { COLOR } from '@/styles/color';

import { StyledTransferCalculatorBox } from './index.style';

type CalculatorBoxProps = {
  display: boolean;
  canEst: boolean;
  msgs: any[];
  estTime: string;
  estFee: string;
};

export const CalculatorBox = ({ ...estData }: CalculatorBoxProps) => {
  return (
    <StyledTransferCalculatorBox>
      <Skeleton
        isLoaded={estData.canEst}
        startColor={COLOR.neutral_4}
        endColor={COLOR.neutral_6}
      >
        <Box alignItems="center" display="flex" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={2}>
            <Tooltip
              hasArrow
              label="The time spent on transaction"
              bg="#0E0E12"
              color={COLOR.neutral_1}
            >
              <Img src={InfoIcon.src} alt="info" />
            </Tooltip>
            <Text
              fontSize={16}
              fontWeight={400}
              lineHeight="22px"
              color={COLOR.neutral_3}
            >
              Time
            </Text>
          </Box>
          <Text>{estData.estTime}</Text>
        </Box>
      </Skeleton>
      <Skeleton
        isLoaded={estData.canEst}
        startColor={COLOR.neutral_4}
        endColor={COLOR.neutral_6}
      >
        <Box alignItems="center" display="flex" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={2}>
            <Tooltip
              hasArrow
              label="Fee spent for transaction"
              bg="#0E0E12"
              color={COLOR.neutral_1}
            >
              <Img src={InfoIcon.src} alt="info" />
            </Tooltip>
            <Text
              fontSize={16}
              fontWeight={400}
              lineHeight="22px"
              color={COLOR.neutral_3}
            >
              Est. Fee
            </Text>
          </Box>
          <Text
            fontSize={16}
            fontWeight={400}
            lineHeight="20px"
            color={COLOR.success}
          >
            {estData.estFee}
          </Text>
        </Box>
      </Skeleton>
    </StyledTransferCalculatorBox>
  );
};
