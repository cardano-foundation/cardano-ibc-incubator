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
 

# Install ghcup
ENV BOOTSTRAP_HASKELL_NONINTERACTIVE=1
ENV BOOTSTRAP_HASKELL_GHC_VERSION=8.10.7
ENV BOOTSTRAP_HASKELL_CABAL_VERSION=3.8.1.0
ENV BOOTSTRAP_HASKELL_INSTALL_NO_STACK=1
ENV BOOTSTRAP_HASKELL_INSTALL_NO_STACK_HOOK=1
RUN bash -c "curl --proto '=https' --tlsv1.2 -sSf https://get-ghcup.haskell.org | sh"

# Add ghcup to PATH
ENV PATH=${PATH}:/root/.local/bin
ENV PATH=${PATH}:/root/.ghcup/bin

# Install cabal
RUN bash -c "ghcup set cabal 3.8.1.0"

# Install GHC
RUN bash -c "ghcup set ghc 8.10.7"

# Update Path to include Cabal and GHC exports
RUN bash -c "echo PATH="$HOME/.local/bin:$PATH" >> $HOME/.bashrc"
RUN bash -c "echo export LD_LIBRARY_PATH="/usr/local/lib:$LD_LIBRARY_PATH" >> $HOME/.bashrc"
RUN bash -c "echo export PKG_CONFIG_PATH="/usr/local/lib/pkgconfig:$PKG_CONFIG_PATH" >> $HOME/.bashrc"
RUN bash -c "echo export C_INCLUDE_PATH="/root/.ghcup/ghc/8.10.7/lib/ghc-8.10.7/include:$C_INCLUDE_PATH" >> $HOME/.bashrc"
RUN bash -c "echo export DO_NOT_TRACK=1 >> $HOME/.bashrc"
RUN bash -c "source $HOME/.bashrc"

# Update cabal
RUN bash -c "cabal update"

FROM builder as cabal
# Install lib for Cardano node

# libsodium
RUN bash -c "mkdir -p $HOME/cardano-src/libsodium"
RUN bash -c "git clone https://github.com/IntersectMBO/libsodium $HOME/cardano-src/libsodium"
WORKDIR "/root/cardano-src/libsodium"
RUN bash -c "git checkout dbb48cc"
RUN bash -c "./autogen.sh"
RUN bash -c "./configure"
RUN bash -c "make"
RUN bash -c "make install"

# libsecp256k1
RUN bash -c "mkdir -p $HOME/cardano-src/secp256k1"
RUN bash -c "git clone https://github.com/bitcoin-core/secp256k1 $HOME/cardano-src/secp256k1"
WORKDIR "/root/cardano-src/secp256k1"
RUN bash -c "git checkout ac83be33"
RUN bash -c "./autogen.sh"
RUN bash -c "./configure --enable-module-schnorrsig --enable-experimental"
RUN bash -c "make"
RUN bash -c "make check"
RUN bash -c "make install"
RUN bash -c "ldconfig"

# BLST
RUN bash -c "mkdir -p $HOME/cardano-src/blst"
RUN bash -c "git clone https://github.com/supranational/blst $HOME/cardano-src/blst"
WORKDIR "/root/cardano-src/blst"
RUN bash -c "git checkout v0.3.10"
RUN bash -c "./build.sh"

RUN echo $'[repo] \n\
    prefix=/usr/local \n\
    exec_prefix=\${prefix} \n\
    libdir=\${exec_prefix}/lib \n\
    includedir=\${prefix}/include \n\
    \n\
    Name: libblst \n\
    Description: Multilingual BLS12-381 signature library \n\
    URL: https://github.com/supranational/blst \n\
    Version: 0.3.10 \n\
    Cflags: -I\${includedir} \n\
    Libs: -L\${libdir} -lblst' > libblst.pc

RUN bash -c "cp libblst.pc /usr/local/lib/pkgconfig/"
RUN bash -c "cp bindings/blst_aux.h bindings/blst.h bindings/blst.hpp  /usr/local/include/"
RUN bash -c "cp libblst.a /usr/local/lib"
RUN bash -c "chmod u=rw,go=r /usr/local/{lib/{libblst.a,pkgconfig/libblst.pc},include/{blst.{h,hpp},blst_aux.h}}"
COPY "./cabalStore.tar.gz" "/root/.cabal/store/"

RUN bash -c "cd /root/.cabal/store/ && tar -xvf cabalStore.tar.gz"

FROM cabal as ffi 
RUN bash -c "mkdir -p /root/sidechain/workspace2/haskell-part"
COPY "./haskell-part" "/root/sidechain/workspace2/haskell-part"
WORKDIR "/root/sidechain/workspace2/haskell-part"
RUN bash -c "cabal update"
RUN bash -c "cabal install --only-dependencies cardano-ibc-helper"

# Install Ignite
FROM ffi as ignitex 
RUN bash -c "curl https://get.ignite.com/cli! | bash"

RUN bash -c "echo export GOFLAGS='-buildvcs=false' >> $HOME/.bashrc"
RUN bash -c "source $HOME/.bashrc"

RUN bash -c "mkdir -p /root/sidechain/workspace2/go"
COPY "./go" "/root/sidechain/workspace2/go"
WORKDIR "/root/sidechain/workspace2/haskell-part"
RUN bash -c "make buildSo"
RUN bash -c "cp /root/.ghcup/ghc/8.10.7/lib/ghc-8.10.7/rts/libHSrts-ghc8.10.7.so /root/sidechain/workspace2/go"

RUN bash -c "mkdir -p /root/sidechain/workspace2/sidechain"
COPY "./sidechain" "/root/sidechain/workspace2/sidechain"
# WORKDIR "/root/sidechain/workspace2/haskell-part"
# RUN bash -c "make buildGo"

WORKDIR "/root/sidechain/workspace2/sidechain"
RUN bash -c "cp /root/sidechain/workspace2/go/libcardano-ibc-helper.so /root/sidechain/workspace2/sidechain/x/clients/cardano/"

COPY "./entrypoint.sh" "/entrypoint.sh"
RUN chmod +x /entrypoint.sh
# RUN bash -c "cd /root/sidechain/workspace2/sidechain && DO_NOT_TRACK=1 ignite chain serve"

EXPOSE 26657
EXPOSE 4500
EXPOSE 1317

ENTRYPOINT ["/entrypoint.sh"]
# CMD "ignite chain serve --help"
# CMD ["/bin/bash", "-c" , "cd /root/sidechain/workspace2/sidechain && DO_NOT_TRACK=1 ignite chain serve"]
CMD ["sh"]