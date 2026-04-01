'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  GridItem,
  Heading,
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import { toast } from 'react-toastify';
import { useAddress, useWallet } from '@meshsdk/react';
import { COLOR } from '@/styles/color';
import {
  buildCheqdIcqTx,
  type CheqdIcqBuildParams,
  type CheqdIcqBuildResponse,
  type CheqdIcqQueryKind,
  type CheqdIcqResultResponse,
  pollCheqdIcqResult,
} from '@/apis/restapi/cardano';

type QueryFieldKey =
  | 'id'
  | 'version'
  | 'collectionId'
  | 'name'
  | 'resourceType';

type QueryField = {
  key: QueryFieldKey;
  label: string;
  placeholder: string;
};

type QueryDefinition = {
  kind: CheqdIcqQueryKind;
  label: string;
  remotePath: string;
  description: string;
  fields: QueryField[];
};

type QueryFormValues = Record<QueryFieldKey, string>;

type PollState = {
  txHash: string;
  queryPath: string;
  packetDataHex: string;
  sourceChannel: string;
  sinceHeight?: string;
};

const QUERY_DEFINITIONS: QueryDefinition[] = [
  {
    kind: 'didDoc',
    label: 'DID Doc',
    remotePath: '/cheqd.did.v2.Query/DidDoc',
    description: 'Fetch the current DID document and its metadata from cheqd.',
    fields: [
      {
        key: 'id',
        label: 'DID',
        placeholder: 'did:cheqd:testnet:...',
      },
    ],
  },
  {
    kind: 'didDocVersion',
    label: 'DID Doc Version',
    remotePath: '/cheqd.did.v2.Query/DidDocVersion',
    description: 'Fetch one historical DID document version by version id.',
    fields: [
      {
        key: 'id',
        label: 'DID',
        placeholder: 'did:cheqd:testnet:...',
      },
      {
        key: 'version',
        label: 'Version',
        placeholder: 'v1',
      },
    ],
  },
  {
    kind: 'didDocVersionsMetadata',
    label: 'DID Version History',
    remotePath: '/cheqd.did.v2.Query/AllDidDocVersionsMetadata',
    description: 'List metadata for all DID document versions known to cheqd.',
    fields: [
      {
        key: 'id',
        label: 'DID',
        placeholder: 'did:cheqd:testnet:...',
      },
    ],
  },
  {
    kind: 'resource',
    label: 'Resource',
    remotePath: '/cheqd.resource.v2.Query/Resource',
    description: 'Fetch a concrete resource payload plus its metadata.',
    fields: [
      {
        key: 'collectionId',
        label: 'Collection ID',
        placeholder: 'zF7rhDBfUt9d1xvN5kQ2Bq',
      },
      {
        key: 'id',
        label: 'Resource ID',
        placeholder: 'resource-id',
      },
    ],
  },
  {
    kind: 'resourceMetadata',
    label: 'Resource Metadata',
    remotePath: '/cheqd.resource.v2.Query/ResourceMetadata',
    description: 'Fetch metadata only for a known cheqd resource.',
    fields: [
      {
        key: 'collectionId',
        label: 'Collection ID',
        placeholder: 'zF7rhDBfUt9d1xvN5kQ2Bq',
      },
      {
        key: 'id',
        label: 'Resource ID',
        placeholder: 'resource-id',
      },
    ],
  },
  {
    kind: 'latestResourceVersion',
    label: 'Latest Resource',
    remotePath: '/cheqd.resource.v2.Query/LatestResourceVersion',
    description:
      'Resolve the latest resource content for a logical name and type.',
    fields: [
      {
        key: 'collectionId',
        label: 'Collection ID',
        placeholder: 'zF7rhDBfUt9d1xvN5kQ2Bq',
      },
      {
        key: 'name',
        label: 'Name',
        placeholder: 'main',
      },
      {
        key: 'resourceType',
        label: 'Resource Type',
        placeholder: 'JSONSchema',
      },
    ],
  },
  {
    kind: 'latestResourceVersionMetadata',
    label: 'Latest Resource Metadata',
    remotePath: '/cheqd.resource.v2.Query/LatestResourceVersionMetadata',
    description: 'Resolve metadata for the latest resource version only.',
    fields: [
      {
        key: 'collectionId',
        label: 'Collection ID',
        placeholder: 'zF7rhDBfUt9d1xvN5kQ2Bq',
      },
      {
        key: 'name',
        label: 'Name',
        placeholder: 'main',
      },
      {
        key: 'resourceType',
        label: 'Resource Type',
        placeholder: 'JSONSchema',
      },
    ],
  },
];

const EMPTY_FORM_VALUES: QueryFormValues = {
  id: '',
  version: '',
  collectionId: '',
  name: '',
  resourceType: '',
};

const truncateMiddle = (value?: string, visibleCharacters = 10): string => {
  if (!value) {
    return 'Not connected';
  }

  if (value.length <= visibleCharacters * 2) {
    return value;
  }

  return `${value.slice(0, visibleCharacters)}...${value.slice(
    -visibleCharacters,
  )}`;
};

const buildQueryPayload = (
  kind: CheqdIcqQueryKind,
  sourceChannel: string,
  signer: string,
  values: QueryFormValues,
): CheqdIcqBuildParams | null => {
  switch (kind) {
    case 'didDoc':
    case 'didDocVersionsMetadata':
      if (!values.id.trim()) {
        return null;
      }
      return {
        kind,
        sourceChannel,
        signer,
        id: values.id.trim(),
      };
    case 'didDocVersion':
      if (!values.id.trim() || !values.version.trim()) {
        return null;
      }
      return {
        kind,
        sourceChannel,
        signer,
        id: values.id.trim(),
        version: values.version.trim(),
      };
    case 'resource':
    case 'resourceMetadata':
      if (!values.collectionId.trim() || !values.id.trim()) {
        return null;
      }
      return {
        kind,
        sourceChannel,
        signer,
        collectionId: values.collectionId.trim(),
        id: values.id.trim(),
      };
    case 'latestResourceVersion':
    case 'latestResourceVersionMetadata':
      if (
        !values.collectionId.trim() ||
        !values.name.trim() ||
        !values.resourceType.trim()
      ) {
        return null;
      }
      return {
        kind,
        sourceChannel,
        signer,
        collectionId: values.collectionId.trim(),
        name: values.name.trim(),
        resourceType: values.resourceType.trim(),
      };
    default:
      return null;
  }
};

export default function QueriesContainer() {
  const [selectedKind, setSelectedKind] = useState<CheqdIcqQueryKind>('didDoc');
  const [sourceChannel, setSourceChannel] = useState('channel-0');
  const [formValues, setFormValues] =
    useState<QueryFormValues>(EMPTY_FORM_VALUES);
  const [buildResponse, setBuildResponse] =
    useState<CheqdIcqBuildResponse | null>(null);
  const [lastTxHash, setLastTxHash] = useState('');
  const [pollState, setPollState] = useState<PollState | null>(null);
  const [pollResult, setPollResult] = useState<CheqdIcqResultResponse | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  const cardanoAddress = useAddress();
  const { wallet: cardanoWallet } = useWallet();
  const selectedQuery =
    QUERY_DEFINITIONS.find((query) => query.kind === selectedKind) ||
    QUERY_DEFINITIONS[0];

  useEffect(() => {
    if (!pollState) {
      setIsPolling(false);
      return undefined;
    }

    let cancelled = false;
    setIsPolling(true);

    const timeoutId = window.setTimeout(
      async () => {
        const nextResult = await pollCheqdIcqResult({
          txHash: pollState.txHash,
          sinceHeight: pollState.sinceHeight,
          queryPath: pollState.queryPath,
          packetDataHex: pollState.packetDataHex,
          sourceChannel: pollState.sourceChannel,
        });

        if (cancelled || !nextResult) {
          setIsPolling(false);
          return;
        }

        setPollResult(nextResult);

        if (nextResult.status === 'pending') {
          setPollState((current) =>
            current
              ? {
                  ...current,
                  sinceHeight: nextResult.nextSearchFromHeight,
                }
              : current,
          );
          return;
        }

        setPollState(null);
        setIsPolling(false);
      },
      pollState.sinceHeight ? 5000 : 2000,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [pollState]);

  const handleInputChange = (field: QueryFieldKey, value: string) => {
    setFormValues((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleQueryTypeChange = (value: string) => {
    setSelectedKind(value as CheqdIcqQueryKind);
    setFormValues(EMPTY_FORM_VALUES);
    setBuildResponse(null);
    setLastTxHash('');
    setPollResult(null);
    setPollState(null);
  };

  const handleSubmit = async () => {
    if (!cardanoAddress || !cardanoWallet?.signTx || !cardanoWallet.submitTx) {
      toast.error('Connect a Cardano wallet before sending a cheqd ICQ.', {
        theme: 'colored',
      });
      return;
    }

    if (!sourceChannel.trim()) {
      toast.error('Source channel is required.', { theme: 'colored' });
      return;
    }

    const payload = buildQueryPayload(
      selectedKind,
      sourceChannel.trim(),
      cardanoAddress,
      formValues,
    );
    if (!payload) {
      toast.error('Fill in all required cheqd query fields.', {
        theme: 'colored',
      });
      return;
    }

    setIsSubmitting(true);
    setBuildResponse(null);
    setLastTxHash('');
    setPollResult(null);
    setPollState(null);

    try {
      const nextBuildResponse = await buildCheqdIcqTx(payload);
      if (!nextBuildResponse?.unsignedTx?.value) {
        return;
      }

      const unsignedTxHex = Buffer.from(
        nextBuildResponse.unsignedTx.value,
        'base64',
      ).toString('hex');
      const signedTx = await cardanoWallet.signTx(unsignedTxHex, true);
      const txHash = await cardanoWallet.submitTx(signedTx);

      if (!txHash) {
        toast.error('Wallet did not return a transaction hash.', {
          theme: 'colored',
        });
        return;
      }

      setBuildResponse(nextBuildResponse);
      setLastTxHash(txHash);
      setPollResult({
        status: 'pending',
        reason: 'source_tx_not_indexed',
        txHash,
        queryPath: nextBuildResponse.queryPath,
        packetDataHex: nextBuildResponse.packetDataHex,
        currentHeight: '0',
        nextSearchFromHeight: '0',
      });
      setPollState({
        txHash,
        queryPath: nextBuildResponse.queryPath,
        packetDataHex: nextBuildResponse.packetDataHex,
        sourceChannel: nextBuildResponse.sourceChannel,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to sign or submit the Cardano transaction.';
      toast.error(message, { theme: 'colored' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formattedResult =
    pollResult?.status === 'completed'
      ? JSON.stringify(pollResult.acknowledgement, null, 2)
      : JSON.stringify(pollResult, null, 2);

  return (
    <Stack spacing={8}>
      <Box
        position="relative"
        overflow="hidden"
        borderRadius="28px"
        border="1px solid rgba(255,255,255,0.08)"
        background="linear-gradient(135deg, rgba(39,103,252,0.22), rgba(38,38,42,0.94) 50%, rgba(77,254,211,0.12))"
        padding={{ base: 6, md: 8 }}
      >
        <Stack spacing={4} maxW="42rem">
          <Badge
            width="fit-content"
            borderRadius="999px"
            paddingX={3}
            paddingY={1}
            background="rgba(250,250,250,0.12)"
            color={COLOR.neutral_1}
          >
            Async-ICQ PoC
          </Badge>
          <Heading size="xl">Query cheqd from a Cardano wallet</Heading>
          <Text color={COLOR.neutral_2} fontSize="lg">
            This page builds a cheqd async-ICQ packet, asks the connected
            Cardano wallet to sign and submit it, then polls Cardano
            acknowledgement events until the remote query result lands back
            on-chain.
          </Text>
          <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
            <Box rounded="2xl" background="rgba(0,0,0,0.2)" padding={4}>
              <Text
                fontSize="xs"
                textTransform="uppercase"
                color={COLOR.neutral_3}
              >
                Wallet
              </Text>
              <Text marginTop={2} fontWeight="semibold">
                {truncateMiddle(cardanoAddress)}
              </Text>
            </Box>
            <Box rounded="2xl" background="rgba(0,0,0,0.2)" padding={4}>
              <Text
                fontSize="xs"
                textTransform="uppercase"
                color={COLOR.neutral_3}
              >
                Source Port
              </Text>
              <Text marginTop={2} fontWeight="semibold">
                icqhost
              </Text>
            </Box>
            <Box rounded="2xl" background="rgba(0,0,0,0.2)" padding={4}>
              <Text
                fontSize="xs"
                textTransform="uppercase"
                color={COLOR.neutral_3}
              >
                Current Query
              </Text>
              <Text marginTop={2} fontWeight="semibold">
                {selectedQuery.label}
              </Text>
            </Box>
          </SimpleGrid>
        </Stack>
      </Box>

      <Grid templateColumns={{ base: '1fr', xl: '1.05fr 0.95fr' }} gap={6}>
        <GridItem>
          <Box
            borderRadius="24px"
            border="1px solid rgba(255,255,255,0.08)"
            background={COLOR.neutral_6}
            padding={{ base: 5, md: 6 }}
          >
            <Stack spacing={5}>
              <Box>
                <Text
                  fontSize="sm"
                  color={COLOR.neutral_3}
                  textTransform="uppercase"
                  letterSpacing="0.08em"
                >
                  Query Builder
                </Text>
                <Heading size="md" marginTop={2}>
                  Compose the remote cheqd request
                </Heading>
                <Text marginTop={2} color={COLOR.neutral_2}>
                  {selectedQuery.description}
                </Text>
              </Box>

              <Box>
                <Text marginBottom={2} fontSize="sm" color={COLOR.neutral_3}>
                  Query Type
                </Text>
                <Select
                  value={selectedKind}
                  onChange={(event) =>
                    handleQueryTypeChange(event.target.value)
                  }
                  borderColor="rgba(255,255,255,0.08)"
                  background={COLOR.neutral_5}
                >
                  {QUERY_DEFINITIONS.map((query) => (
                    <option key={query.kind} value={query.kind}>
                      {query.label}
                    </option>
                  ))}
                </Select>
              </Box>

              <Box>
                <Text marginBottom={2} fontSize="sm" color={COLOR.neutral_3}>
                  Source Channel
                </Text>
                <Input
                  value={sourceChannel}
                  onChange={(event) => setSourceChannel(event.target.value)}
                  placeholder="channel-0"
                  borderColor="rgba(255,255,255,0.08)"
                  background={COLOR.neutral_5}
                />
              </Box>

              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                {selectedQuery.fields.map((field) => (
                  <Box key={field.key}>
                    <Text
                      marginBottom={2}
                      fontSize="sm"
                      color={COLOR.neutral_3}
                    >
                      {field.label}
                    </Text>
                    <Input
                      value={formValues[field.key]}
                      onChange={(event) =>
                        handleInputChange(field.key, event.target.value)
                      }
                      placeholder={field.placeholder}
                      borderColor="rgba(255,255,255,0.08)"
                      background={COLOR.neutral_5}
                    />
                  </Box>
                ))}
              </SimpleGrid>

              <Flex
                justify="space-between"
                align={{ base: 'flex-start', md: 'center' }}
                direction={{ base: 'column', md: 'row' }}
                gap={4}
              >
                <Box>
                  <Text fontSize="sm" color={COLOR.neutral_3}>
                    Remote Path
                  </Text>
                  <Text fontFamily="mono" fontSize="sm" color={COLOR.neutral_1}>
                    {selectedQuery.remotePath}
                  </Text>
                </Box>
                <Button
                  onClick={handleSubmit}
                  isLoading={isSubmitting}
                  loadingText="Submitting"
                  background={COLOR.primary}
                  color={COLOR.neutral_1}
                  _hover={{ background: '#1f57d8' }}
                >
                  Send Query
                </Button>
              </Flex>
            </Stack>
          </Box>
        </GridItem>

        <GridItem>
          <Stack spacing={6}>
            <Box
              borderRadius="24px"
              border="1px solid rgba(255,255,255,0.08)"
              background={COLOR.neutral_6}
              padding={{ base: 5, md: 6 }}
            >
              <Stack spacing={4}>
                <Flex justify="space-between" align="center">
                  <Box>
                    <Text
                      fontSize="sm"
                      color={COLOR.neutral_3}
                      textTransform="uppercase"
                      letterSpacing="0.08em"
                    >
                      Delivery Status
                    </Text>
                    <Heading size="md" marginTop={2}>
                      Ack polling
                    </Heading>
                  </Box>
                  {isPolling ? (
                    <Flex align="center" gap={2} color={COLOR.success}>
                      <Spinner size="sm" />
                      <Text fontSize="sm">Polling</Text>
                    </Flex>
                  ) : null}
                </Flex>

                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <Box rounded="2xl" background={COLOR.neutral_5} padding={4}>
                    <Text
                      fontSize="xs"
                      textTransform="uppercase"
                      color={COLOR.neutral_3}
                    >
                      Tx Hash
                    </Text>
                    <Text marginTop={2} fontFamily="mono" fontSize="sm">
                      {lastTxHash || 'No query submitted yet'}
                    </Text>
                  </Box>
                  <Box rounded="2xl" background={COLOR.neutral_5} padding={4}>
                    <Text
                      fontSize="xs"
                      textTransform="uppercase"
                      color={COLOR.neutral_3}
                    >
                      Packet Data
                    </Text>
                    <Text marginTop={2} fontFamily="mono" fontSize="sm">
                      {buildResponse?.packetDataHex
                        ? truncateMiddle(buildResponse.packetDataHex, 14)
                        : 'Pending build'}
                    </Text>
                  </Box>
                  <Box rounded="2xl" background={COLOR.neutral_5} padding={4}>
                    <Text
                      fontSize="xs"
                      textTransform="uppercase"
                      color={COLOR.neutral_3}
                    >
                      Query Status
                    </Text>
                    <Text marginTop={2} fontWeight="semibold">
                      {pollResult?.status || 'idle'}
                    </Text>
                    {pollResult?.status === 'pending' ? (
                      <Text marginTop={1} color={COLOR.neutral_2} fontSize="sm">
                        {pollResult.reason === 'source_tx_not_indexed'
                          ? 'Waiting for the source transaction to appear in Cardano history.'
                          : 'Waiting for the acknowledgement to be relayed back to Cardano.'}
                      </Text>
                    ) : null}
                  </Box>
                  <Box rounded="2xl" background={COLOR.neutral_5} padding={4}>
                    <Text
                      fontSize="xs"
                      textTransform="uppercase"
                      color={COLOR.neutral_3}
                    >
                      Search Cursor
                    </Text>
                    <Text marginTop={2} fontFamily="mono" fontSize="sm">
                      {pollResult?.nextSearchFromHeight || 'Not started'}
                    </Text>
                  </Box>
                </SimpleGrid>
              </Stack>
            </Box>

            <Box
              borderRadius="24px"
              border="1px solid rgba(255,255,255,0.08)"
              background={COLOR.neutral_6}
              padding={{ base: 5, md: 6 }}
            >
              <Stack spacing={4}>
                <Box>
                  <Text
                    fontSize="sm"
                    color={COLOR.neutral_3}
                    textTransform="uppercase"
                    letterSpacing="0.08em"
                  >
                    Result
                  </Text>
                  <Heading size="md" marginTop={2}>
                    Decoded acknowledgement
                  </Heading>
                </Box>

                <Box
                  as="pre"
                  margin={0}
                  padding={4}
                  borderRadius="20px"
                  background="rgba(0,0,0,0.24)"
                  color={COLOR.neutral_1}
                  overflowX="auto"
                  whiteSpace="pre-wrap"
                  fontSize="sm"
                >
                  {formattedResult ||
                    'Submit a query to see the decoded ICQ acknowledgement here.'}
                </Box>
              </Stack>
            </Box>
          </Stack>
        </GridItem>
      </Grid>
    </Stack>
  );
}
