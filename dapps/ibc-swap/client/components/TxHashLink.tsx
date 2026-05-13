import { Box, Link } from '@chakra-ui/react';
import { COLOR } from '@/styles/color';
import { getExplorerTxUrl } from '@/utils/txExplorer';

type TxHashLinkProps = {
  chainId?: string;
  txHash?: string;
  fallbackText?: string;
};

export const TxHashLink = ({
  chainId,
  txHash,
  fallbackText = 'transaction pending',
}: TxHashLinkProps) => {
  if (!txHash) return <>{fallbackText}</>;

  const explorerUrl = getExplorerTxUrl(chainId, txHash);
  if (!explorerUrl) {
    return (
      <Box as="span" title={txHash} wordBreak="break-all">
        {txHash}
      </Box>
    );
  }

  return (
    <Link
      href={explorerUrl}
      isExternal
      color={COLOR.info}
      fontWeight={700}
      textDecoration="underline"
      title={txHash}
      wordBreak="break-all"
    >
      {txHash}
    </Link>
  );
};
