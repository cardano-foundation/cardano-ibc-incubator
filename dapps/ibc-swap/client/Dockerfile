FROM node:20-bookworm-slim

WORKDIR /app

COPY dapps/ibc-swap/client/package.json ./
COPY packages/cardano-ibc-planner /packages/cardano-ibc-planner
COPY packages/cardano-ibc-trace-registry /packages/cardano-ibc-trace-registry
COPY packages/cardano-ibc-tx-builder /packages/cardano-ibc-tx-builder
COPY packages/cardano-ibc-tx-builder-runtime /packages/cardano-ibc-tx-builder-runtime

# The swap UI currently needs legacy peer resolution and must skip Husky's
# postinstall hook when installed outside the repo root.
RUN npm install --ignore-scripts --legacy-peer-deps
RUN ln -s /app/node_modules /packages/node_modules

COPY dapps/ibc-swap/client .

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]
