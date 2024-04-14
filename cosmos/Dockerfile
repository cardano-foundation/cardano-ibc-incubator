ARG GO_VERSION="1.21.4"

FROM golang:${GO_VERSION} as builder

# Install dependencies *You don't need all of them
RUN apt-get update -y \
    && apt-get upgrade -y \
    && apt-get install -y git jq bc make automake libnuma-dev \
    && apt-get install -y rsync htop curl build-essential \
    && apt-get install -y pkg-config libffi-dev libgmp-dev \
    && apt-get install -y libssl-dev libtinfo-dev libsystemd-dev \
    && apt-get install -y zlib1g-dev make g++ wget libncursesw5 libtool autoconf tmux \
    && apt-get clean
 
RUN bash -c "curl https://get.ignite.com/cli! | bash"

RUN bash -c "echo export GOFLAGS='-buildvcs=false' >> $HOME/.bashrc"
RUN bash -c "source $HOME/.bashrc"

RUN bash -c "mkdir -p /root/sidechain/workspace/sidechain"
COPY "./sidechain" "/root/sidechain/workspace/sidechain"
WORKDIR "/root/sidechain/workspace/sidechain"

COPY "./entrypoint.sh" "/entrypoint.sh"
RUN chmod +x /entrypoint.sh
# RUN bash -c "cd /root/sidechain/workspace2/sidechain && DO_NOT_TRACK=1 ignite chain serve"

EXPOSE 26657
EXPOSE 26656
EXPOSE 4500
EXPOSE 1317

# RUN bash -c "DO_NOT_TRACK=1 GOFLAGS='-buildvcs=false' C_INCLUDE_PATH="/root/.ghcup/ghc/8.10.7/lib/ghc-8.10.7/include:$C_INCLUDE_PATH" ignite chain build -y && ignite chain init -y "

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sh"]