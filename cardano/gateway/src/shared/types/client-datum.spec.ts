import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import * as Lucid from '@lucid-evolution/lucid';

import { ClientDatum, decodeClientDatum, encodeClientDatum } from './client-datum';

describe('client datum codec', () => {
  it('preserves consensus-state map insertion order', async () => {
    const newHeight = { revisionNumber: 777n, revisionHeight: 385n };
    const oldHeight = { revisionNumber: 777n, revisionHeight: 154n };
    const datum: ClientDatum = {
      state: {
        clientState: {
          chainId: Buffer.from('injective-777').toString('hex'),
          trustLevel: { numerator: 1n, denominator: 3n },
          trustingPeriod: 864000000000000n,
          unbondingPeriod: 1814400000000000n,
          maxClockDrift: 31536920000000000n,
          frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
          latestHeight: newHeight,
          proofSpecs: [],
        },
        consensusStates: new Map([
          [
            newHeight,
            {
              timestamp: 1781817737286267722n,
              next_validators_hash: '28db295e63efd6f32c4714d1b90f81a13b1f541c51a1473142fa0deadf6b6087',
              root: { hash: '4b5605244c21e9f1d81389b887e6e93d43d412ef6d528480bd60b57e455ff462' },
            },
          ],
          [
            oldHeight,
            {
              timestamp: 1781817504041311404n,
              next_validators_hash: '28db295e63efd6f32c4714d1b90f81a13b1f541c51a1473142fa0deadf6b6087',
              root: { hash: '09c282fb427c90ecc62025dae60759caf54651ad4e594307909603c40b3c8116' },
            },
          ],
        ]),
        processedTimes: new Map([
          [newHeight, 1767226383000000000n],
          [oldHeight, 1767226156000000000n],
        ]),
        processedHeights: new Map([
          [newHeight, 441806595n],
          [oldHeight, 441806539n],
        ]),
      },
      token: {
        policyId: 'b2d0da8fb7f7632ca7bdef6db660a679dcdb7cf10fb736ee685deb36',
        name: 'ecf8e5b874f2c8bf4be616c75c7f53ab4661f080f2c9db6430',
      },
    };
    const lucidImporter = { ...Lucid, CML } as typeof Lucid;

    const encoded = await encodeClientDatum(datum, lucidImporter);
    const decoded = await decodeClientDatum(encoded, lucidImporter);

    expect([...decoded.state.consensusStates.keys()].map((height) => height.revisionHeight)).toEqual([385n, 154n]);
    expect([...decoded.state.processedTimes.keys()].map((height) => height.revisionHeight)).toEqual([385n, 154n]);
    expect([...decoded.state.processedHeights.keys()].map((height) => height.revisionHeight)).toEqual([385n, 154n]);
  });
});
