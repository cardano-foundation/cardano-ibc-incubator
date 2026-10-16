FROM golang:1.26.9 AS client-preparation
WORKDIR /src/cosmos/cardano-probabilistic-light-client-v8
COPY ./cosmos/cardano-probabilistic-light-client-core /src/cosmos/cardano-probabilistic-light-client-core
COPY ./cosmos/cardano-probabilistic-light-client-v8 /src/cosmos/cardano-probabilistic-light-client-v8
# Mithril certificate verification uses blst, which needs cgo. Link statically
# so the binary runs in the Node image.
RUN CGO_ENABLED=1 CGO_CFLAGS="-O2 -D__BLST_PORTABLE__" GOWORK=off go build -trimpath -tags netgo,osusergo \
  -ldflags '-linkmode external -extldflags "-static"' -o /prepare-client ./cmd/prepare-client

# Image proto type
FROM node:22@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d AS protos

WORKDIR /usr/src/proto-types

COPY ./proto-types .

RUN npm ci

RUN npm run build

# Base image
FROM node:22@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d

ARG MAIN_CONTEXT=cardano/gateway
# Create app directory
WORKDIR /usr/src/app
ENV NODE_PATH=/usr/src/app/node_modules
ENV CARDANO_CLIENT_PREPARER=/usr/local/bin/cardano-client-prepare
COPY --from=client-preparation /prepare-client /usr/local/bin/cardano-client-prepare

# Bundle app source
COPY ${MAIN_CONTEXT} .
COPY ./packages /usr/packages
COPY --from=protos /usr/src/proto-types /usr/proto-types
COPY ./manifests /usr/src/app/manifests

# Build local file dependencies that publish compiled artifacts from dist/.
RUN npm ci --prefix /usr/packages/cardano-ibc-trace-registry \
  && npm run --prefix /usr/packages/cardano-ibc-trace-registry build

RUN npm ci --prefix /usr/packages/cardano-ibc-tx-builder \
  && npm run --prefix /usr/packages/cardano-ibc-tx-builder build \
  && npm ci --prefix /usr/packages/cardano-ibc-tx-builder-runtime \
  && npm run --prefix /usr/packages/cardano-ibc-tx-builder-runtime build \
  && npm prune --prefix /usr/packages/cardano-ibc-tx-builder-runtime --omit=dev

# Install app dependencies
RUN npm ci

# Creates a "dist" folder with the production build
RUN npm run build

ENV CONSENSUS_HISTORY_CACHE_DIR=/var/lib/cardano-ibc/consensus-history
# Docker initializes an empty named volume from this directory, including its
# ownership. The Gateway must be able to create SQLite files as the node user.
RUN install -d -o node -g node -m 0700 "$CONSENSUS_HISTORY_CACHE_DIR"

USER node

CMD ["node", "dist/main.js"]
