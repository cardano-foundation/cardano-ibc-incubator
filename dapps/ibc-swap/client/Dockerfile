FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS dependencies

WORKDIR /workspace/dapps/ibc-swap/client

ENV HUSKY=0
ENV NEXT_TELEMETRY_DISABLED=1

COPY dapps/ibc-swap/client/package.json dapps/ibc-swap/client/package-lock.json ./
COPY packages/cardano-ibc-planner /workspace/packages/cardano-ibc-planner
COPY packages/cardano-ibc-trace-registry /workspace/packages/cardano-ibc-trace-registry
COPY packages/cardano-ibc-tx-builder /workspace/packages/cardano-ibc-tx-builder
COPY packages/cardano-ibc-tx-builder-runtime /workspace/packages/cardano-ibc-tx-builder-runtime

# The peer graph still contains legacy constraints, but the committed lockfile
# makes the accepted resolution reproducible.
RUN npm ci --ignore-scripts --legacy-peer-deps \
  && ln -sfn /workspace/dapps/ibc-swap/client/node_modules /workspace/packages/node_modules

FROM dependencies AS build

ARG BASE_PATH=""
ENV BASE_PATH=${BASE_PATH}

COPY dapps/ibc-swap/client ./
RUN npm run test \
  && npm run build -- --no-lint \
  && npm run test:runtime-image

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime

ARG BASE_PATH=""
ENV HOSTNAME=0.0.0.0
ENV IBC_SWAP_BASE_PATH=${BASE_PATH}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

WORKDIR /app

# Standalone output contains only traced production dependencies. Deployment
# values are served by /api/runtime-config, so this image is never rebuilt on
# container startup.
COPY --from=build --chown=node:node /workspace/dapps/ibc-swap/client/.next/standalone ./
COPY --from=build --chown=node:node /workspace/dapps/ibc-swap/client/.next/static /app/dapps/ibc-swap/client/.next/static
COPY --from=build --chown=node:node /workspace/dapps/ibc-swap/client/public /app/dapps/ibc-swap/client/public

USER node
EXPOSE 3000

CMD ["node", "dapps/ibc-swap/client/server.js"]
