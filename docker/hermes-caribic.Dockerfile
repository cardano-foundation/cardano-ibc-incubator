# Hermes runtime image with the Caribic binary available for explicit-network
# relayer configuration and startup helpers.
#
# Build from the repository root so both the relayer workspace and caribic are
# available:
#   docker build -f docker/hermes-caribic.Dockerfile .

FROM rust:1-bookworm@sha256:705e294093973d7c10e83400393dce7b3611f8e03e55a80af7fff6d02ae1affb AS hermes-build

ARG PROTOC_VERSION=28.3

WORKDIR /src/relayer

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    clang \
    libssl-dev \
    pkg-config \
    unzip \
    wget \
  && rm -rf /var/lib/apt/lists/*

RUN ARCH="$(uname -m)" \
  && case "$ARCH" in \
    x86_64) PROTOC_ARCH=x86_64; PROTOC_SHA256=0ad949f04a6a174da83cdcbdb36dee0a4925272a5b6d83f79a6bf9852076d53f ;; \
    aarch64) PROTOC_ARCH=aarch_64; PROTOC_SHA256=1de522032a8b194002fe35cab86d747848238b5e4de4f99648372079f5b46f9a ;; \
    *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;; \
  esac \
  && wget "https://github.com/protocolbuffers/protobuf/releases/download/v${PROTOC_VERSION}/protoc-${PROTOC_VERSION}-linux-${PROTOC_ARCH}.zip" -O /tmp/protoc.zip \
  && echo "${PROTOC_SHA256}  /tmp/protoc.zip" | sha256sum --check --strict \
  && unzip /tmp/protoc.zip -d /usr/local \
  && rm -f /tmp/protoc.zip

COPY relayer/ ./
RUN cargo build --locked --release --bin hermes

FROM rust:1-bookworm@sha256:705e294093973d7c10e83400393dce7b3611f8e03e55a80af7fff6d02ae1affb AS caribic-build

WORKDIR /src/caribic

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl-dev \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

COPY caribic/Cargo.toml caribic/Cargo.lock ./
COPY caribic/src ./src
RUN cargo build --locked --release --bin caribic

FROM ubuntu:24.04@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea
LABEL maintainer="hello@informal.systems"

ARG UID=2000
ARG GID=2000

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl-dev \
    procps \
    wget \
  && update-ca-certificates \
  && groupadd -g ${GID} hermes \
  && useradd -l -m hermes -s /bin/bash -u ${UID} -g ${GID} \
  && mkdir -p /home/hermes/relayer/target/release /home/hermes/caribic/config /home/hermes/manifests/preprod /home/hermes/manifests/preview \
  && chown -R hermes:hermes /home/hermes \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /home/hermes

COPY --from=hermes-build /src/relayer/target/release/hermes /usr/bin/hermes
COPY --from=caribic-build /src/caribic/target/release/caribic /usr/bin/caribic
COPY --chown=hermes:hermes caribic/config/default-config.json caribic/config/hermes-config.example.toml /home/hermes/caribic/config/
COPY --chown=hermes:hermes manifests/preprod/cardano-preprod-handler.json manifests/preprod/cardano-preprod-bridge-manifest.json /home/hermes/manifests/preprod/
COPY --chown=hermes:hermes manifests/preview/cardano-preview-handler.json manifests/preview/cardano-preview-bridge-manifest.json /home/hermes/manifests/preview/

RUN ln -sfn /usr/bin/hermes /home/hermes/relayer/target/release/hermes

# Keep the image smoke deterministic and offline: compilation exercises both
# binaries, while these checks verify the runtime layout and tracked profiles.
RUN set -eu; \
  /usr/bin/hermes --version; \
  /usr/bin/caribic --version; \
  /usr/bin/caribic --config /home/hermes/caribic/config/default-config.json chains | grep -q 'network: preview'; \
  test -s /home/hermes/caribic/config/default-config.json; \
  test -s /home/hermes/manifests/preprod/cardano-preprod-handler.json; \
  test -s /home/hermes/manifests/preview/cardano-preview-handler.json

USER hermes:hermes
ENTRYPOINT ["/usr/bin/hermes"]
