# STEP 1: Builder Stage
ARG GO_VERSION="1.21.4"
FROM golang:${GO_VERSION}-bookworm AS builder

# Set build-time environments
ENV GOFLAGS="-buildvcs=false"
ENV DO_NOT_TRACK=1

# Install only necessary build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git make build-essential libsystemd-dev pkg-config \
    libnuma-dev curl ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Ignite CLI securely
RUN curl https://get.ignite.com/cli@v28.11.2! | bash

# Workspace setup
WORKDIR /src

# Leverage Docker cache: Copy only dependency files first
# (Assuming sidechain has a go.mod file)
COPY ./sidechain/go.mod* ./sidechain/go.sum* ./
RUN go mod download

# Copy the rest of the source code
COPY ./sidechain .

# Build the binary (adjust binary name accordingly)
RUN ignite chain build -y --release

# STEP 2: Runner Stage (Final Image)
# Using a smaller and secure base image for production
FROM debian:bookworm-slim

# Create a non-privileged user for security
RUN groupadd -r sidechain && useradd -r -g sidechain sidechain

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary from builder
COPY --from=builder /go/bin/sidechaind /usr/local/bin/sidechaind
COPY --from=builder /entrypoint.sh /entrypoint.sh

# Set correct permissions
RUN chmod +x /entrypoint.sh && chown sidechain:sidechain /app

# Networking
EXPOSE 26657 26656 4500 1317

# Run as non-root user
USER sidechain

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sidechaind", "start"]
