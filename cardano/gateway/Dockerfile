FROM node:20@sha256:bd3086f61c05f8925ed2026bee608a40ad9f8a5d28b6e593342237469ee5b621

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
COPY proto-types/package.json ./proto-types/package.json
COPY packages/cardano-ibc-planner/package.json ./packages/cardano-ibc-planner/package.json
COPY packages/cardano-ibc-trace-registry/package.json ./packages/cardano-ibc-trace-registry/package.json
COPY packages/cardano-ibc-tx-builder/package.json ./packages/cardano-ibc-tx-builder/package.json
COPY packages/cardano-ibc-tx-builder-runtime/package.json ./packages/cardano-ibc-tx-builder-runtime/package.json
COPY cardano/gateway/package.json ./cardano/gateway/package.json
COPY dapps/ibc-swap/client/package.json ./dapps/ibc-swap/client/package.json

RUN npm ci --ignore-scripts --legacy-peer-deps

COPY proto-types ./proto-types
COPY packages ./packages
COPY cardano/gateway ./cardano/gateway

RUN npm run build:gateway

WORKDIR /usr/src/app/cardano/gateway

CMD ["node", "dist/main.js"]
