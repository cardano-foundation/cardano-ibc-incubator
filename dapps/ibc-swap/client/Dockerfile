FROM node:20-bookworm-slim

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
COPY proto-types/package.json ./proto-types/package.json
COPY packages/cardano-ibc-planner/package.json ./packages/cardano-ibc-planner/package.json
COPY packages/cardano-ibc-trace-registry/package.json ./packages/cardano-ibc-trace-registry/package.json
COPY packages/cardano-ibc-tx-builder/package.json ./packages/cardano-ibc-tx-builder/package.json
COPY packages/cardano-ibc-tx-builder-runtime/package.json ./packages/cardano-ibc-tx-builder-runtime/package.json
COPY cardano/gateway/package.json ./cardano/gateway/package.json
COPY dapps/ibc-swap/client/package.json ./dapps/ibc-swap/client/package.json

RUN npm install --ignore-scripts --legacy-peer-deps

COPY packages ./packages
COPY dapps/ibc-swap/client ./dapps/ibc-swap/client

WORKDIR /usr/src/app/dapps/ibc-swap/client

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
