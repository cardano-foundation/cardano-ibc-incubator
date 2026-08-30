# Build with the repository root as the Docker context.
FROM golang:1.24-bookworm@sha256:1a6d4452c65dea36aac2e2d606b01b4a029ec90cc1ae53890540ce6173ea77ac AS wrapper-builder
WORKDIR /src
COPY cardano/sp1-tendermint-prover/bn254-to-bls-wrapper/go.mod cardano/sp1-tendermint-prover/bn254-to-bls-wrapper/go.sum ./
RUN go mod download
COPY cardano/sp1-tendermint-prover/bn254-to-bls-wrapper/main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/bn254-to-bls-wrapper .

FROM rust:1.91-bookworm@sha256:c1e5f19e773b7878c3f7a805dd00a495e747acbdc76fb2337a4ebf0418896b33 AS service-builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential clang libclang-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY cardano/sp1-tendermint-prover/Cargo.toml cardano/sp1-tendermint-prover/Cargo.lock ./
COPY cardano/sp1-tendermint-prover/src ./src
RUN cargo build --locked --release

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home prover
COPY --from=service-builder /src/target/release/cardano-ibc-sp1-tendermint-prover /usr/local/bin/
COPY --from=wrapper-builder /out/bn254-to-bls-wrapper /usr/local/bin/
COPY third_party/ibc-eureka/sp1-programs-v2.0.0 /opt/cardano-ibc/eureka/sp1-programs-v2.0.0
RUN cd /opt/cardano-ibc/eureka/sp1-programs-v2.0.0 \
    && sha256sum --check --strict SHA256SUMS
RUN mkdir -p /var/lib/cardano-ibc-wrapper \
    && chown prover:prover /var/lib/cardano-ibc-wrapper

USER prover
ENV SP1_TENDERMINT_LISTEN_ADDR=0.0.0.0:8080 \
    SP1_TENDERMINT_ELF=/opt/cardano-ibc/eureka/sp1-programs-v2.0.0/sp1-ics07-tendermint-update-client \
    SP1_TENDERMINT_MISBEHAVIOUR_ELF=/opt/cardano-ibc/eureka/sp1-programs-v2.0.0/sp1-ics07-tendermint-misbehaviour \
    CARDANO_BLS_WRAPPER_BIN=/usr/local/bin/bn254-to-bls-wrapper \
    CARDANO_BLS_WRAPPER_KEY_DIR=/var/lib/cardano-ibc-wrapper \
    CARDANO_BLS_WRAPPER_PUBLIC_VK=/var/lib/cardano-ibc-wrapper/verification_key.json
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/cardano-ibc-sp1-tendermint-prover"]
