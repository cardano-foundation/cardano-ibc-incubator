import {
  allChains,
  chainsMapping,
  findTokenImg,
  UNKNOWN_TOKEN_IMG,
} from './customChainInfo';

test('network choices cover the local fixture and public Injective networks', () => {
  expect(allChains.map((chain) => chain.chain_id)).toEqual([
    'v8-classic-1',
    'injective-888',
    'injective-1',
    chainsMapping[process.env.REACT_APP_CARDANO_CHAIN_ID || '764824073']
      .chain_id,
  ]);
});

test('token metadata follows the configured chain ID rather than its first word', () => {
  expect(findTokenImg('v8-classic-1', 'stake')).not.toBe(UNKNOWN_TOKEN_IMG);
  expect(findTokenImg('v8-classic-1', 'transfer/channel-0/utest')).not.toBe(
    UNKNOWN_TOKEN_IMG,
  );
  expect(findTokenImg('injective-888', 'inj')).not.toBe(UNKNOWN_TOKEN_IMG);
  expect(findTokenImg('injective-888', 'inj')).toBe(
    findTokenImg('injective-1', 'inj'),
  );
  expect(findTokenImg('injective-unknown', 'inj')).toBe(UNKNOWN_TOKEN_IMG);
  expect(findTokenImg('v8-classic-1', 'unknown')).toBe(UNKNOWN_TOKEN_IMG);
});
