# Image proto type
FROM node:20@sha256:bd3086f61c05f8925ed2026bee608a40ad9f8a5d28b6e593342237469ee5b621 AS protos

WORKDIR /usr/src/proto-types

COPY ./proto-types .

RUN npm ci

RUN npm run build

# Base image
FROM node:20@sha256:bd3086f61c05f8925ed2026bee608a40ad9f8a5d28b6e593342237469ee5b621

ARG MAIN_CONTEXT=cardano/gateway
# Create app directory
WORKDIR /usr/src/app
ENV NODE_PATH=/usr/src/app/node_modules

# Bundle app source
COPY ${MAIN_CONTEXT} .
COPY ./packages /usr/packages
COPY --from=protos /usr/src/proto-types /usr/proto-types

# Install app dependencies
RUN npm ci --legacy-peer-deps

# Creates a "dist" folder with the production build
RUN npm run build

CMD ["node", "dist/main.js"]
