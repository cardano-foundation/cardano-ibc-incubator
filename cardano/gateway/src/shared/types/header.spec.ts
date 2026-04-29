import headerMockBuilder from '../../tx/test/mock/header';
import { clientDatumMockBuilder } from '../../tx/test/mock/client-datum';
import { initializeHeader, verifyHeader } from './header';

describe('verifyHeader', () => {
  it('accepts adjacent headers when adjacency checks pass', () => {
    const headerMsg = headerMockBuilder.withTrustedHeight(158476n, 0n).build();
    const header = initializeHeader(headerMsg);

    const clientDatum = clientDatumMockBuilder
      .withChainId(Buffer.from('entrypoint', 'utf8').toString('hex'))
      .build();

    clientDatum.state.consensusStates = new Map([
      [
        { revisionNumber: 0n, revisionHeight: 158476n },
        {
          timestamp: 1711599499024248921n,
          next_validators_hash: Buffer.from(headerMsg.signed_header.header.validators_hash).toString('hex'),
          root: {
            hash: '7cddffb29294833fc977e362d42da7c329e5de8844d0e9cd4c28909cb0e7284c',
          },
        },
      ],
    ]);

    expect(verifyHeader(header, clientDatum)).toBe(true);
  });
});
