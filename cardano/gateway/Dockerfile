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
