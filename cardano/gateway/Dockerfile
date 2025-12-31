# Image proto type
FROM node:18 AS protos

WORKDIR /usr/src/proto-types

COPY ./proto-types .

RUN npm install

RUN npm run build

# Base image
FROM node:18

ARG MAIN_CONTEXT=cardano/gateway
# Create app directory
WORKDIR /usr/src/app

# Bundle app source
COPY ${MAIN_CONTEXT} .
COPY --from=protos /usr/src/proto-types /usr/proto-types

# Install app dependencies
RUN npm install --legacy-peer-deps

# Creates a "dist" folder with the production build
RUN npm run build

CMD ["node", "dist/main.js"]
