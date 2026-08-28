# Build with `studies/sp1_tendermint_cardano` as the Docker context.
FROM golang:1.24-bookworm AS wrapper-builder
WORKDIR /src
COPY bn254-to-bls-wrapper/go.mod bn254-to-bls-wrapper/go.sum ./
RUN go mod download
COPY bn254-to-bls-wrapper/main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/bn254-to-bls-wrapper .

FROM rust:1.91-bookworm AS service-builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential clang libclang-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY prover-service/Cargo.toml prover-service/Cargo.lock ./
COPY prover-service/src ./src
RUN cargo build --locked --release

FROM debian:bookworm-slim AS elf-fetcher
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
ARG EUREKA_ELF_URL=https://github.com/cosmos/ibc-contracts/releases/download/sp1-programs-v2.0.0/sp1-ics07-tendermint-update-client
ARG EUREKA_ELF_SHA256=6a6a40df2b1339455de7b238fdf3e914f4c2f99e85b8fc4abb65fb1664f42270
ARG EUREKA_MISBEHAVIOUR_ELF_URL=https://github.com/cosmos/ibc-contracts/releases/download/sp1-programs-v2.0.0/sp1-ics07-tendermint-misbehaviour
ARG EUREKA_MISBEHAVIOUR_ELF_SHA256=6ec141ebb604565dfb7669f8482bd3eacc57ae35158ba3931f1c20f78f7bf921
RUN mkdir -p /out \
    && curl --fail --location --silent --show-error "$EUREKA_ELF_URL" --output /out/eureka-update-client.elf \
    && echo "$EUREKA_ELF_SHA256  /out/eureka-update-client.elf" | sha256sum --check --strict \
    && curl --fail --location --silent --show-error "$EUREKA_MISBEHAVIOUR_ELF_URL" --output /out/eureka-misbehaviour.elf \
    && echo "$EUREKA_MISBEHAVIOUR_ELF_SHA256  /out/eureka-misbehaviour.elf" | sha256sum --check --strict

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home prover
COPY --from=service-builder /src/target/release/cardano-ibc-sp1-tendermint-prover /usr/local/bin/
COPY --from=wrapper-builder /out/bn254-to-bls-wrapper /usr/local/bin/
COPY --from=elf-fetcher /out/eureka-update-client.elf /opt/cardano-ibc/eureka-update-client.elf
COPY --from=elf-fetcher /out/eureka-misbehaviour.elf /opt/cardano-ibc/eureka-misbehaviour.elf
RUN mkdir -p /var/lib/cardano-ibc-wrapper \
    && chown prover:prover /var/lib/cardano-ibc-wrapper

USER prover
ENV SP1_TENDERMINT_LISTEN_ADDR=0.0.0.0:8080 \
    SP1_TENDERMINT_ELF=/opt/cardano-ibc/eureka-update-client.elf \
    SP1_TENDERMINT_MISBEHAVIOUR_ELF=/opt/cardano-ibc/eureka-misbehaviour.elf \
    CARDANO_BLS_WRAPPER_BIN=/usr/local/bin/bn254-to-bls-wrapper \
    CARDANO_BLS_WRAPPER_KEY_DIR=/var/lib/cardano-ibc-wrapper \
    CARDANO_BLS_WRAPPER_PUBLIC_VK=/var/lib/cardano-ibc-wrapper/verification_key.json
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/cardano-ibc-sp1-tendermint-prover"]
