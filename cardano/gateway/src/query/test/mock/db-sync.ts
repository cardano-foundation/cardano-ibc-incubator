const dbServiceMock = {
  findHeightByTxHash: 650879,
  findBlockByHeight: {
    height: 650879,
    slot: '2602775',
    epoch: 6,
    block_id: '650882',
  },
  findEpochParamByEpochNo: {
    epoch_no: 6,
    nonce: '4a6292aea1c1d8bd978b1d3d6c7105457fec7002c53f99f1c59885def967a57c',
  },
  findActiveValidatorsByEpoch: [
    {
      pool_id: 'pool13gsek6vd8dhqxsu346zvae30r4mtd77yth07fcc7p49kqc3fd09',
      vrf_key_hash: 'fec17ed60cbf2ec5be3f061fb4de0b6ef1f20947cfbfce5fb2783d12f3f69ff5',
    },
  ],
  findUtxosByBlockNo: [
    {
      txId: '',
      address: 'addr_test1wzdepv6775uw6pzwvsmy0lyzr6c8jzh70cwymhf3jumn3lcljf37d',
      txHash: 'ab8c4cdf609305d49ae4fa75684cfa906ced458151185c67872296618cbf120a',
      outputIndex: 1,
      datum:
        'd8799fd8799f4e6962635f636c69656e742d3335359fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f4e3039392d63617264616e6f2d323440d8799f43696263ffff00ffd8799f581c8a893f54dc9fda44a2ee3e1590f375ce31106b16ff9b017302b66fff581b94051031ba171ddc7783efe491f76b4d2f1ba64019dd9b30323535ffff',
      datumHash: '84b04e6b7fad0eaf3e63ede754e8484249a176616486f247e0c17228a9f5ab8b',
      assetsName: '94051031ba171ddc7783efe491f76b4d2f1ba64019dd9b30323535',
      assetsPolicy: '8a893f54dc9fda44a2ee3e1590f375ce31106b16ff9b017302b66fff',
    },
    {
      txId: '',
      address: 'addr_test1wqqs9872rwc7mu282445vn903l4j2xe2q64e4nx9wjayu6gha9nff',
      txHash: 'ab8c4cdf609305d49ae4fa75684cfa906ced458151185c67872296618cbf120a',
      outputIndex: 0,
      datum:
        'd8799fd8799f19016519010015ffd8799f581cae402aa242a85d03dde0913882ec6cb0f36edec61ccd501692de14724768616e646c6572ffff',
      datumHash: '34b545359b810ad3231150c6cb04dc8c21ed29e0d21d55308eca157b64c2e73b',
      assetsName: '68616e646c6572',
      assetsPolicy: 'ae402aa242a85d03dde0913882ec6cb0f36edec61ccd501692de1472',
    },
    {
      txId: '',
      address: 'addr_test1wzvcr66fhtmprkl95uahrl8thr6k9accw2stqxvjfs6xlzgyu630m',
      txHash: 'a6cb5c233eed81ac92134ef8e430bd93be773eba8d16899eeaf3f2356bd26f1f',
      outputIndex: 0,
      datum:
        'd8799fd8799fd8799f4973696465636861696ed8799f0103ff1b0005795974ab80001b0006722feb7b00001b0000008bb2c97000d8799f0000ffd8799f001a00018a6aff9fd8799fd8799f010001014100ffd8799f9f0001ff1821040c4001ff0000d87980ffd8799fd8799f010001014100ffd8799f9f0001ff182001014001ff0000d87980ffffffa3d8799f001a00018a4affd8799f1b17b5da0db13d840058202bb0d076a52ec04d14b227a78f851a7ff808120e74168c4c1e4c807a9f23c986d8799f5820af1bef214868f440fa458add7e7ac7ef8037d1c33f28a506778b986b53995709ffffd8799f001a00018a5effd8799f1b17b5da1289e9360058202bb0d076a52ec04d14b227a78f851a7ff808120e74168c4c1e4c807a9f23c986d8799f58201d54671e1dd7aca6acd3026121aa1318d358e6bdaa02e5c67c2e89bf9e23d205ffffd8799f001a00018a6affd8799f1b17b5da156bfecc0058202bb0d076a52ec04d14b227a78f851a7ff808120e74168c4c1e4c807a9f23c986d8799f5820061b9ae9834bde828161e1d13f267994884f0faba0b08538b446a9ee2ec2b0faffffffd8799f581c2954599599f3200cf37ae003e4775668fd312332675504b1fee7f436581b94051031ba171ddc7783efe491f76b4d2f1ba640f2c9db64323435ffff',
      datumHash: 'fe57284c29535573d11aaf3cc72ecda8c21e1d3adf55d10863f19c59bc21ec31',
      assetsName: '94051031ba171ddc7783efe491f76b4d2f1ba640f2c9db64323435',
      assetsPolicy: '2954599599f3200cf37ae003e4775668fd312332675504b1fee7f436',
    },
    {
      txId: '',
      address: 'addr_test1wzvcr66fhtmprkl95uahrl8thr6k9accw2stqxvjfs6xlzgyu630m',
      txHash: 'dd4c783d573ee646821ac579fed47502bd5b0e7e9c9b918fdd7200113fe68f40',
      outputIndex: 1,
      datum:
        'd8799fd8799fd8799f4930312d636f736d6f73d8799f0203ff1b00038d7ea4c680001b00038d7ea4c6800101d8799f0000ffd8799f001864ff80ffa1d8799f001864ffd8799f1b17b532b782a18a404140d8799f4140ffffffd8799f581c2954599599f3200cf37ae003e4775668fd312332675504b1fee7f43658192ce3733549309f4b89886f156b9ad54fa5e7e4f8f2c9db6430ffff',
      datumHash: '4f1d5ba1a9e54b0bc8c32a020a25638ca9d1bb5559e5db8390b244e62f58bef9',
      assetsName: '2ce3733549309f4b89886f156b9ad54fa5e7e4f8f2c9db6430',
      assetsPolicy: '2954599599f3200cf37ae003e4775668fd312332675504b1fee7f436',
      blockNo: 604862,
      index: 1,
    },
    {
      txId: '',
      address: 'addr_test1wqqs9872rwc7mu282445vn903l4j2xe2q64e4nx9wjayu6gha9nff',
      txHash: 'dd4c783d573ee646821ac579fed47502bd5b0e7e9c9b918fdd7200113fe68f40',
      outputIndex: 0,
      datum:
        'd8799fd8799f010000ffd8799f581c8af05abd0aa96ab554bad0fc17e635727afdcfeea5d833c961baba934768616e646c6572ffff',
      datumHash: 'b720b21d264712cecbbf84c9a3562da39c35579b22b57d495fa493f5225b942c',
      assetsName: '68616e646c6572',
      assetsPolicy: 'ae402aa242a85d03dde0913882ec6cb0f36edec61ccd501692de1472',
      blockNo: 604862,
      index: 0,
    },
    {
      txId: '',
      address: 'addr_test1wzvcr66fhtmprkl95uahrl8thr6k9accw2stqxvjfs6xlzgyu630m',
      txHash: 'f8529a77ea686edcb651402874196c2cdcc7ba85e94358fa777d9e9a13caf069',
      outputIndex: 0,
      datum:
        'd8799fd8799fd8799f4930312d636f736d6f73d8799f0203ff1b00038d7ea4c680001b00038d7ea4c6800101d8799f0000ffd8799f001865ff80ffa2d8799f001864ffd8799f1b17b532b782a18a404140d8799f4140ffffd8799f001865ffd8799f1b17b532bace92bc004140d8799f4140ffffffd8799f581c2954599599f3200cf37ae003e4775668fd312332675504b1fee7f43658192ce3733549309f4b89886f156b9ad54fa5e7e4f8f2c9db6430ffff',
      datumHash: '83f5b2d78553c779e6de48032afe6c170a4b82dfa2d3b168de54a23e14879b36',
      assetsName: '2ce3733549309f4b89886f156b9ad54fa5e7e4f8f2c9db6430',
      assetsPolicy: '2954599599f3200cf37ae003e4775668fd312332675504b1fee7f436',
      blockNo: 604866,
      index: 0,
    },
  ],
  findUtxoClientOrAuthHandler: [],
  checkExistPoolUpdateByBlockNo: true,
  checkExistPoolRetireByBlockNo: true,
  findUtxosByPolicyIdAndPrefixTokenName: [
    {
      address: 'addr_test1wzdepv6775uw6pzwvsmy0lyzr6c8jzh70cwymhf3jumn3lcljf37d',
      txHash: 'ab8c4cdf609305d49ae4fa75684cfa906ced458151185c67872296618cbf120a',
      outputIndex: 1,
      datum:
        'd8799fd8799f4e6962635f636c69656e742d3335359fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87a80d8799f4e3039392d63617264616e6f2d323440d8799f43696263ffff00ffd8799f581c8a893f54dc9fda44a2ee3e1590f375ce31106b16ff9b017302b66fff581b94051031ba171ddc7783efe491f76b4d2f1ba64019dd9b30323535ffff',
      datumHash: '84b04e6b7fad0eaf3e63ede754e8484249a176616486f247e0c17228a9f5ab8b',
      assetsName: '94051031ba171ddc7783efe491f76b4d2f1ba64019dd9b30323535',
      assetsPolicy: '8a893f54dc9fda44a2ee3e1590f375ce31106b16ff9b017302b66fff',
    },
  ],
  findUtxoByPolicyAndTokenNameAndState: {
    address: 'addr_test1wzdepv6775uw6pzwvsmy0lyzr6c8jzh70cwymhf3jumn3lcljf37d',
    txHash: 'dfc34360ac5a6bf87786a468e3783c8e6a039c99eb104d89ad60a0a848e5bc5b',
    outputIndex: 0,
    datum:
      'd8799fd8799f4c6962635f636c69656e742d309fd8799f41319f4d4f524445525f4f5244455245444f4f524445525f554e4f524445524544ffffffd87c80d8799f4c31302d63617264616e6f2d314e636f6e6e656374696f6e2d313030d8799f43696263ffff00ffd8799f581c8a893f54dc9fda44a2ee3e1590f375ce31106b16ff9b017302b66fff581994051031ba171ddc7783efe491f76b4d2f1ba64019dd9b3030ffff',
    datumHash: '8b26fd49b5f581f81ffd24e574e876f949e5b8d0e3a038d9259d6f86b92f6699',
    assetsName: '94051031ba171ddc7783efe491f76b4d2f1ba64019dd9b3030',
    assetsPolicy: '8a893f54dc9fda44a2ee3e1590f375ce31106b16ff9b017302b66fff',
    blockNo: 650879,
    index: 0,
  },
  getRedeemersByTxIdAndMintScriptOrSpendAddr: [],
};

export { dbServiceMock };