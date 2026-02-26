# Image proto type
FROM node:18@sha256:c6ae79e38498325db67193d391e6ec1d224d96c693a8a4d943498556716d3783 AS protos

WORKDIR /usr/src/proto-types

COPY ./proto-types .

RUN npm ci

RUN npm run build

# Base image
FROM node:18@sha256:c6ae79e38498325db67193d391e6ec1d224d96c693a8a4d943498556716d3783

ARG MAIN_CONTEXT=cardano/gateway
# Create app directory
WORKDIR /usr/src/app

# Bundle app source
COPY ${MAIN_CONTEXT} .
COPY --from=protos /usr/src/proto-types /usr/proto-types

# Install app dependencies
RUN npm ci --legacy-peer-deps

# Creates a "dist" folder with the production build
RUN npm run build

CMD ["node", "dist/main.js"]
