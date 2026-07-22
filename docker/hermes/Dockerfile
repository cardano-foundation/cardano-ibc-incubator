# syntax=docker/dockerfile:1

# Hermes relayer (Cardano fork).
# Built from the `relayer/` git submodule (cardano-foundation/hermes-relayer).
# The build mirrors what `caribic` does: `cargo build --release --bin hermes`.
#
# This Dockerfile lives in the parent repo (docker/hermes/) so it is NOT
# shadowed by the relayer submodule. The Earthfile invokes it with the
# relayer/ submodule directory as the build context, so `COPY . .` copies the
# relayer source.
#
# NOTE: this image only contains the hermes binary. Runtime configuration
# (~/.hermes/config.toml) and keys are expected to be supplied via mounts /
# secrets at deploy time.

ARG RUST_VERSION="1.83"
ARG RUNNER_IMAGE="debian:bookworm-slim"

# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------
FROM rust:${RUST_VERSION}-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    build-essential \
    pkg-config \
    libssl-dev \
    libclang-dev \
    clang \
    protobuf-compiler \
    libprotobuf-dev \
    && rm -rf /var/lib/apt/lists/*

ENV LIBCLANG_PATH=/usr/lib/llvm-14/lib

WORKDIR /relayer

# Build context is the relayer/ submodule directory.
COPY . .

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/relayer/target \
    cargo build --release --bin hermes && \
    cp /relayer/target/release/hermes /usr/local/bin/hermes

# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
FROM ${RUNNER_IMAGE}

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/hermes /usr/local/bin/hermes

# Hermes config and keyring live here at runtime.
ENV HERMES_HOME=/root/.hermes
WORKDIR /root/.hermes

ENTRYPOINT ["hermes"]
