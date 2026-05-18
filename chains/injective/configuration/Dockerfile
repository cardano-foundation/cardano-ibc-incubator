# syntax=docker/dockerfile:1

ARG GO_VERSION="1.23"
ARG RUNNER_IMAGE="ubuntu:24.04"

FROM golang:${GO_VERSION}-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    build-essential \
    git \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /injective

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    GOWORK=off go mod tidy

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    GOWORK=off go build \
    -mod=readonly \
    -o /usr/local/bin/injectived \
    ./cmd/injectived

RUN --mount=type=cache,target=/go/pkg/mod \
    mkdir -p /usr/local/lib && \
    find /go/pkg/mod -path '*/api/libwasmvm*.so' -exec cp {} /usr/local/lib/ \;

FROM ${RUNNER_IMAGE}

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    jq \
    sed \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/bin/injectived /usr/local/bin/injectived
COPY --from=builder /usr/local/lib/libwasmvm*.so /usr/local/lib/

ENV HOME=/root
ENV LD_LIBRARY_PATH=/usr/local/lib
WORKDIR /root

EXPOSE 26657
EXPOSE 1317
EXPOSE 9090

ENTRYPOINT ["injectived"]
