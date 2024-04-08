# Use the latest Go version as the builder stage
FROM golang:latest as builder

# Set the working directory inside the builder stage
WORKDIR /app

# Copy the source code into the image
COPY . .

# Build the application binary using the provided Makefile
RUN make build

# Start a new stage from a smaller base image to reduce final image size
FROM frolvlad/alpine-glibc:latest

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

# Use Dockerize to wait for the Node.js service to be ready before starting the application
#CMD dockerize -wait tcp://0.0.0.0:26657 -timeout 60s ./scripts/relayer-start.sh

CMD ["sleep", "infinity"]