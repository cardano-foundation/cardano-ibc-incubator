# syntax=docker/dockerfile:1.7

ARG GO_IMAGE=golang:1.23.8-alpine
ARG RUNTIME_IMAGE=alpine:3.22.2

FROM ${GO_IMAGE} AS builder

ARG IBC_GO_MAJOR
ARG IBC_GO_REF
ARG IBC_GO_COMMIT

RUN apk add --no-cache \
    gcc \
    git \
    libusb-dev \
    linux-headers \
    make \
    musl-dev \
    perl \
    tar

RUN test -n "${IBC_GO_MAJOR}" \
    && test -n "${IBC_GO_REF}" \
    && test -n "${IBC_GO_COMMIT}"

WORKDIR /src
RUN git clone --depth 1 --branch "${IBC_GO_REF}" https://github.com/cosmos/ibc-go.git ibc-go \
    && test "$(git -C ibc-go rev-parse HEAD)" = "${IBC_GO_COMMIT}"

COPY cosmos/cardano-probabilistic-light-client-core /cardano-ibc/cosmos/cardano-probabilistic-light-client-core
COPY cosmos/cardano-probabilistic-light-client-v8 /cardano-ibc/cosmos/cardano-probabilistic-light-client-v8
COPY cosmos/cardano-probabilistic-light-client-v10 /cardano-ibc/cosmos/cardano-probabilistic-light-client-v10
COPY chains/cosmos/patch_cardano_probabilistic_light_client.sh /usr/local/bin/patch-cardano-light-client

RUN /usr/local/bin/patch-cardano-light-client /src/ibc-go /cardano-ibc \
    && cd /src/ibc-go \
    && go mod tidy \
    && if [ "${IBC_GO_MAJOR}" = "10" ]; then \
         cd /src/ibc-go/simapp && go mod tidy; \
       fi

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    cd /src/ibc-go \
    && if [ "${IBC_GO_MAJOR}" = "8" ]; then \
         BUILD_TAGS=muslc make build; \
       else \
         make build; \
       fi \
    && install -Dm755 /src/ibc-go/build/simd /out/simd

FROM ${RUNTIME_IMAGE}

ARG PROFILE
ARG IBC_GO_VERSION
ARG IBC_GO_COMMIT
ARG IBC_SEMANTICS

LABEL org.opencontainers.image.title="Cardano IBC Cosmos compatibility chain" \
      org.opencontainers.image.source="https://github.com/cardano-foundation/cardano-ibc-incubator" \
      org.cardano-ibc.profile="${PROFILE}" \
      org.cardano-ibc.ibc-go-version="${IBC_GO_VERSION}" \
      org.cardano-ibc.ibc-go-commit="${IBC_GO_COMMIT}" \
      org.cardano-ibc.semantics="${IBC_SEMANTICS}"

RUN apk add --no-cache bash ca-certificates curl jq sed

COPY --from=builder /out/simd /usr/local/bin/simd
COPY chains/cosmos/scripts/setup_profile.sh /usr/local/bin/setup-cosmos-profile
COPY chains/cosmos/config /opt/cardano-ibc/cosmos-profile-config

ENV SIMD_HOME=/var/lib/simd
WORKDIR /var/lib/simd

EXPOSE 1317 9090 26656 26657

ENTRYPOINT ["/usr/local/bin/setup-cosmos-profile"]
