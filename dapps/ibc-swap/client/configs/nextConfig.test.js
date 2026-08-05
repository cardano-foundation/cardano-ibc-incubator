const assert = require('node:assert/strict');
const test = require('node:test');

test('Next applies a nonempty base path exactly once to redirects', async () => {
  const previousBasePath = process.env.BASE_PATH;
  process.env.BASE_PATH = '/ibc';
  const configPath = require.resolve('../next.config.js');
  delete require.cache[configPath];

  try {
    const nextConfig = require(configPath);
    assert.equal(nextConfig.basePath, '/ibc');
    assert.equal(nextConfig.env.NEXT_PUBLIC_BASE_PATH, '/ibc');
    const redirects = await nextConfig.redirects();
    assert.deepEqual(
      redirects.map(({ source, destination }) => ({ source, destination })),
      [
        { source: '/', destination: '/transfer' },
        { source: '/swap', destination: '/transfer' },
        { source: '/queries', destination: '/transfer' },
      ],
    );
  } finally {
    if (previousBasePath === undefined) {
      delete process.env.BASE_PATH;
    } else {
      process.env.BASE_PATH = previousBasePath;
    }
    delete require.cache[configPath];
  }
});
