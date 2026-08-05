FROM node:20-bookworm-slim

WORKDIR /workspace/dapps/ibc-swap/client

COPY dapps/ibc-swap/client/package.json dapps/ibc-swap/client/package-lock.json ./
COPY packages/cardano-ibc-planner /workspace/packages/cardano-ibc-planner
COPY packages/cardano-ibc-trace-registry /workspace/packages/cardano-ibc-trace-registry
COPY packages/cardano-ibc-tx-builder /workspace/packages/cardano-ibc-tx-builder
COPY packages/cardano-ibc-tx-builder-runtime /workspace/packages/cardano-ibc-tx-builder-runtime

# The swap UI currently needs legacy peer resolution and must skip Husky's
# postinstall hook when installed outside the repo root.
RUN npm ci --ignore-scripts --legacy-peer-deps
RUN ln -s /workspace/dapps/ibc-swap/client/node_modules /workspace/packages/node_modules

COPY dapps/ibc-swap/client .

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
