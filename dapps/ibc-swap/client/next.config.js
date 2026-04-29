const path = require('path');
const { join } = path;
const { copyFileSync, existsSync, mkdirSync } = require('fs');
const { access, copyFile, mkdir, symlink } = require('fs/promises');
const webpack = require('webpack');

const basePath = process?.env?.BASE_PATH || '';

// Avoid bundling optional native `ws` addons into Next API routes. The pure JS
// implementation is sufficient here and avoids webpack interop issues.
process.env.WS_NO_BUFFER_UTIL ||= '1';
process.env.WS_NO_UTF_8_VALIDATE ||= '1';

function ensureSodiumWrapperEsmArtifact() {
  const packageRoots = [
    __dirname,
    path.resolve(__dirname, '../../../packages/cardano-ibc-tx-builder'),
    path.resolve(__dirname, '../../../packages/cardano-ibc-tx-builder-runtime'),
    path.resolve(__dirname, '../../../packages/cardano-ibc-trace-registry'),
  ];

  for (const packageRoot of packageRoots) {
    const source = path.join(
      packageRoot,
      'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs',
    );
    const target = path.join(
      packageRoot,
      'node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs',
    );

    if (!existsSync(source) || existsSync(target)) continue;

    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

ensureSodiumWrapperEsmArtifact();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath,
  experimental: {
    externalDir: true,
  },
  transpilePackages: [
    '@cardano-ibc/tx-builder-runtime',
    '@cardano-ibc/planner',
    '@cardano-ibc/trace-registry',
  ],
  webpack: function (config, options) {
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };
    config.plugins = config.plugins || [];
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];

    config.optimization.providedExports = true;

    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, './'),
      '@cardano-ibc/tx-builder': path.resolve(
        __dirname,
        '../../../packages/cardano-ibc-tx-builder/dist/index.js',
      ),
      'js-sha3': require.resolve('js-sha3'),
    };
    config.output.environment = {
      ...config.output.environment,
      asyncFunction: true,
    };

    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    });

    // libsodium-wrappers-sumo ships an ESM entrypoint that imports a sibling
    // file it does not actually publish. Redirect that request to the real
    // module from libsodium-sumo so the swap UI can compile reliably.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^\.\/libsodium-sumo\.mjs$/,
        path.resolve(
          __dirname,
          'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs',
        ),
      ),
    );

    config.plugins.push(
      new (class {
        apply(compiler) {
          compiler.hooks.afterEmit.tapPromise(
            'SymlinkWebpackPlugin',
            async (compiler) => {
              if (options.isServer) {
                const from = join(compiler.options.output.path, '../static');
                const to = join(compiler.options.output.path, 'static');

                try {
                  await access(from);
                  // console.log(`${from} already exists`);
                  return;
                } catch (error) {
                  if (error.code === 'ENOENT') {
                    // No link exists
                  } else {
                    throw error;
                  }
                }

                await symlink(to, from, 'junction');
                console.log(`created symlink ${from} -> ${to}`);
              }
            },
          );
        }
      })(),
    );

    config.plugins.push(
      new (class {
        async copyWasm() {
          const vendorChunksDir = path.resolve(
            __dirname,
            '.next/server/vendor-chunks',
          );
          const wasmFiles = [
            {
              source: require.resolve(
                '@anastasia-labs/cardano-multiplatform-lib-nodejs/cardano_multiplatform_lib_bg.wasm',
              ),
              target: 'cardano_multiplatform_lib_bg.wasm',
            },
            {
              source: require.resolve(
                '@lucid-evolution/uplc/dist/node/uplc_tx_bg.wasm',
              ),
              target: 'uplc_tx_bg.wasm',
            },
            {
              source: require.resolve(
                '@emurgo/cardano-message-signing-nodejs/cardano_message_signing_bg.wasm',
              ),
              target: 'cardano_message_signing_bg.wasm',
            },
          ];

          await mkdir(vendorChunksDir, { recursive: true });
          await Promise.all(
            wasmFiles.map(({ source, target }) =>
              copyFile(source, join(vendorChunksDir, target)),
            ),
          );
        }

        apply(compiler) {
          compiler.hooks.afterEmit.tapPromise(
            'CardanoMultiplatformWasmPlugin',
            async () => {
              if (options.isServer) await this.copyWasm();
            },
          );
          compiler.hooks.done.tapPromise(
            'CardanoMultiplatformWasmPlugin',
            async () => {
              if (options.isServer) await this.copyWasm();
            },
          );
        }
      })(),
    );

    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
        port: '',
        pathname: '**',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: `${basePath}/swap`,
        permanent: true,
      },
      {
        source: basePath || '/',
        destination: `${basePath}/swap`,
        permanent: true,
      },
    ];
  },
};
module.exports = nextConfig;
