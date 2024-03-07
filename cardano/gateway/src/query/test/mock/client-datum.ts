const clientDatumMock = {
  state: {
    clientState: {
      chainId: '73696465636861696e',
      trustLevel: {
        numerator: 1n,
        denominator: 3n,
      },
      trustingPeriod: 1540800000000000n,
      unbondingPeriod: 1814400000000000n,
      maxClockDrift: 600000000000n,
      frozenHeight: {
        revisionNumber: 0n,
        revisionHeight: 0n,
      },
      latestHeight: {
        revisionNumber: 0n,
        revisionHeight: 100970n,
      },
      proofSpecs: [
        {
          leaf_spec: {
            hash: 1n,
            prehash_key: 0n,
            prehash_value: 1n,
            length: 1n,
            prefix: '00',
          },
          inner_spec: {
            child_order: [0n, 1n],
            child_size: 33n,
            min_prefix_length: 4n,
            max_prefix_length: 12n,
            empty_child: '',
            hash: 1n,
          },
          max_depth: 0n,
          min_depth: 0n,
          prehash_key_before_comparison: false,
        },
        {
          leaf_spec: {
            hash: 1n,
            prehash_key: 0n,
            prehash_value: 1n,
            length: 1n,
            prefix: '00',
          },
          inner_spec: {
            child_order: [0n, 1n],
            child_size: 32n,
            min_prefix_length: 1n,
            max_prefix_length: 1n,
            empty_child: '',
            hash: 1n,
          },
          max_depth: 0n,
          min_depth: 0n,
          prehash_key_before_comparison: false,
        },
      ],
    },
    consensusStates: new Map([
      [
        { revisionNumber: 0n, revisionHeight: 100970n },
        {
          timestamp: 1708511419198000128n,
          next_validators_hash: '2bb0d076a52ec04d14b227a78f851a7ff808120e74168c4c1e4c807a9f23c986',
          root: {
            hash: 'd6dec2d58c04ccbeedc6e8ab415840ffb4894353c5e06686abc451adcd3a446a',
          },
        },
      ],
    ]),
  },
  token: {
    policyId: '2954599599f3200cf37ae003e4775668fd312332675504b1fee7f436',
    name: '94051031ba171ddc7783efe491f76b4d2f1ba640f2c9db64323435',
  },
};

export { clientDatumMock };
