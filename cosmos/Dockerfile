ARG GO_VERSION="1.21.4"

FROM golang:${GO_VERSION} as builder

ENV PATH="/root/.ignite/bin:/go/bin:/usr/local/go/bin:${PATH}"

# Install dependencies *You don't need all of them
RUN apt-get update -y \
    && apt-get upgrade -y \
    && apt-get install -y git jq bc make automake libnuma-dev \
    && apt-get install -y rsync htop curl build-essential \
    && apt-get install -y pkg-config libffi-dev libgmp-dev \
    && apt-get install -y libssl-dev libtinfo-dev libsystemd-dev \
    && apt-get install -y zlib1g-dev make g++ wget libncursesw5 libtool autoconf tmux \
    && apt-get clean

RUN bash -c "curl https://get.ignite.com/cli@v28.11.2! | bash"

# Install buf and protobuf generator plugins required by Ignite's OpenAPI generation step.
RUN /usr/local/go/bin/go install github.com/bufbuild/buf/cmd/buf@v1.32.0 \
    && /usr/local/go/bin/go install github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-openapiv2@v2.20.0 \
    && /usr/local/go/bin/go install github.com/grpc-ecosystem/grpc-gateway/protoc-gen-swagger@v1.16.0

RUN bash -c "echo export GOFLAGS='-buildvcs=false' >> $HOME/.bashrc"
RUN bash -c "source $HOME/.bashrc"

RUN bash -c "mkdir -p /root/entrypoint/workspace/entrypoint"
COPY "./entrypoint" "/root/entrypoint/workspace/entrypoint"
WORKDIR "/root/entrypoint/workspace/entrypoint"

RUN test -x /go/bin/buf && mv /go/bin/buf /go/bin/buf.real
COPY "./buf-wrapper.sh" "/go/bin/buf"
RUN chmod +x /go/bin/buf /go/bin/buf.real

COPY "./entrypoint.sh" "/entrypoint.sh"
RUN chmod +x /entrypoint.sh
# RUN bash -c "cd /root/entrypoint/workspace2/entrypoint && DO_NOT_TRACK=1 ignite chain serve"

EXPOSE 26657
EXPOSE 26656
EXPOSE 4500
EXPOSE 1317

# RUN bash -c "DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' C_INCLUDE_PATH="/root/.ghcup/ghc/8.10.7/lib/ghc-8.10.7/include:$C_INCLUDE_PATH" ignite chain build -y && ignite chain init -y "

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sh"]
