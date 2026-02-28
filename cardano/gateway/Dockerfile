# Image proto type
FROM node:20 AS protos

WORKDIR /usr/src/proto-types

COPY ./proto-types .

RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-factor 2 \
    && npm config set fetch-retry-mintimeout 1000 \
    && npm config set fetch-retry-maxtimeout 60000 \
    && npm config set registry https://registry.npmjs.org/ \
    && for attempt in 1 2 3; do \
        npm ci --no-audit --prefer-offline && exit 0; \
        echo "npm ci failed for proto-types (attempt ${attempt}/3), retrying..."; \
        sleep $((attempt * 5)); \
      done; \
    exit 1

RUN npm run build

# Base image
FROM node:20

ARG MAIN_CONTEXT=cardano/gateway
# Create app directory
WORKDIR /usr/src/app

# Bundle app source
COPY ${MAIN_CONTEXT} .
COPY --from=protos /usr/src/proto-types /usr/proto-types

# Install app dependencies
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-factor 2 \
    && npm config set fetch-retry-mintimeout 1000 \
    && npm config set fetch-retry-maxtimeout 60000 \
    && npm config set registry https://registry.npmjs.org/ \
    && for attempt in 1 2 3; do \
        npm ci --legacy-peer-deps --no-audit --prefer-offline && exit 0; \
        echo "npm ci failed for gateway app (attempt ${attempt}/3), retrying..."; \
        sleep $((attempt * 5)); \
      done; \
    exit 1

# Creates a "dist" folder with the production build
RUN npm run build

CMD ["node", "dist/main.js"]
