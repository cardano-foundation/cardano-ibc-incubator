# Use the latest Go version as the builder stage
FROM golang:latest as builder
ARG MAIN_CONTEX=relayer
# Set the working directory inside the builder stage
WORKDIR /app

# Copy the source code into the image
COPY ${MAIN_CONTEX} .
COPY ./proto-types ./../proto-types

# Build the application binary using the provided Makefile
RUN make build

FROM alpine:latest

RUN apk add --no-cache libc6-compat

# Install openssl, required for secure network communications
RUN apk add --no-cache openssl

# Set the version for Dockerize, a utility to wait for services
ENV DOCKERIZE_VERSION v0.6.1

# Download and install Dockerize to facilitate service dependency waiting
RUN wget https://github.com/jwilder/dockerize/releases/download/$DOCKERIZE_VERSION/dockerize-alpine-linux-amd64-$DOCKERIZE_VERSION.tar.gz \
    && tar -C /usr/local/bin -xzvf dockerize-alpine-linux-amd64-$DOCKERIZE_VERSION.tar.gz \
    && rm dockerize-alpine-linux-amd64-$DOCKERIZE_VERSION.tar.gz

# Install bash and jq for scripting and JSON processing
RUN apk add --no-cache bash jq nano

# Set the working directory in the final image
WORKDIR /root/

# Copy the built application binary and scripts from the builder stage
COPY --from=builder /app/bin/rly ./bin/
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/examples ./examples
COPY --from=builder /app/.env .env

# Use Dockerize to wait for the Node.js service to be ready before starting the application
# CMD dockerize -wait tcp://0.0.0.0:26657 -wait tcp://0.0.0.0:4884 -timeout 120s ./scripts/relayer-start.sh

# CMD ["sleep", "infinity"]
ENTRYPOINT ["./scripts/relayer-start.sh"]