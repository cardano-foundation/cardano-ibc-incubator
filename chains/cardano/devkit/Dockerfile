FROM bloxbean/yaci-cli:0.11.0-beta1@sha256:d54bcec436750e90b58a3d702223975212897a770af967ed0ea9ba1c07fbab75 AS devkit-tools
FROM cardanosolutions/ogmios:v7.0.0@sha256:8892ef5f77b94f1c95427cf9f2b40e6235a32b27a8b1e378db02289f3991617f AS ogmios-tools

# Use the same dynamically linked node as the maintained local profile. The
# bundled static node cannot use the local clock required by pool-age policy.
FROM ghcr.io/blinklabs-io/cardano-node:11.1.3-2@sha256:dc2b885811294fc497bcd50224bdf1e51d693f6113c749a3b21be1428af79ef8 AS native-node

# Debug ledger queries require the CLI built with this node's ledger decoder.
# The base image's newer CLI silently falls back to a CBOR dump instead of JSON.
FROM native-node AS cli-tools
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) release_checksum=530fb99986fbdccc46f9ee0dd86cabb1393b015feac9173cb731d89fa748365f ;; \
      arm64) release_checksum=3b638c87448bf08d3680f9116ca92e876579b865c0540f8f33b5c586a02ebf8a ;; \
      *) exit 1 ;; \
    esac \
    && mkdir /release \
    && curl --fail --location --silent --show-error --retry 3 \
      "https://github.com/IntersectMBO/cardano-node/releases/download/11.1.3/cardano-node-11.1.3-linux-${TARGETARCH}.tar.gz" \
      --output /release/bundle.tar.gz \
    && printf '%s  /release/bundle.tar.gz\n' "$release_checksum" | sha256sum --check --status \
    && tar -xzf /release/bundle.tar.gz -C /release ./bin/cardano-cli \
    && install -m 755 /release/bin/cardano-cli /usr/local/bin/cardano-cli \
    && rm -rf /release

FROM native-node AS devkit
COPY --from=cli-tools /usr/local/bin/cardano-cli /usr/local/bin/cardano-cli
RUN apt-get update \
    && apt-get install -y --no-install-recommends libfaketime python3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/cardano-bin /app/logs
COPY --from=devkit-tools /app/yaci-cli /app/yaci-cli
COPY --from=devkit-tools /app/yaci-cli.jar /app/yaci-cli.jar
COPY --from=devkit-tools /app/config /app/config
COPY --from=devkit-tools /app/kupo /app/kupo
# Ogmios 7 supports the protocol-11 node and exact-block certificate queries.
COPY --from=ogmios-tools /bin/ogmios /app/ogmios/bin/ogmios
RUN /app/ogmios/bin/ogmios --version
RUN ln -sf /profile/cardano_node.py /app/cardano-bin/cardano-node \
    && ln -sf /profile/cardano_submit_api.py /app/cardano-bin/cardano-submit-api \
    && ln -sf /usr/local/bin/cardano-cli /app/cardano-bin/cardano-cli.bin
COPY devkit/cardano-cli.sh /app/cardano-bin/cardano-cli
RUN chmod +x /app/cardano-bin/cardano-cli
ENV PATH="/app/cardano-bin:${PATH}"
ENV CARDANO_NODE_SOCKET_PATH=/clusters/nodes/default/node/node.sock
ENV PROTOCOL_MAGIC=42
WORKDIR /app
COPY devkit/entrypoint.sh /profile/entrypoint.sh
COPY devkit/nonce.py /profile/nonce.py
COPY devkit/cardano_node.py /profile/cardano_node.py
COPY devkit/cardano_cli.py /profile/cardano_cli.py
COPY devkit/cardano_submit_api.py /profile/cardano_submit_api.py
COPY devkit/bootstrap.py /profile/bootstrap.py
RUN chmod +x /profile/cardano_node.py /profile/cardano_submit_api.py
COPY devkit/node.properties /app/config/node.properties
COPY config/protocol-parameters.json /config/protocol-parameters.json

FROM bloxbean/yaci-store:2.0.2.1@sha256:9a75cb006db1710a9de02b566de158d8d561058328b8e1219531d2c2c79778e9 AS history
COPY yaci/config/application.properties /app/config/application.properties
