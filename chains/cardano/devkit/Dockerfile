FROM bloxbean/yaci-cli:0.11.0-beta1@sha256:d54bcec436750e90b58a3d702223975212897a770af967ed0ea9ba1c07fbab75 AS devkit-tools
FROM cardanosolutions/ogmios:v7.0.0@sha256:8892ef5f77b94f1c95427cf9f2b40e6235a32b27a8b1e378db02289f3991617f AS ogmios-tools

# Use the same dynamically linked node as the maintained local profile. The
# bundled static node cannot use the local clock required by pool-age policy.
FROM ghcr.io/blinklabs-io/cardano-node:11.0.1-1@sha256:d5ede07a890e9b6a0a5182cdba9dbaf73756336762235e0934a11690beedae02 AS devkit
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
COPY devkit/bootstrap.py /profile/bootstrap.py
RUN chmod +x /profile/cardano_node.py
COPY devkit/node.properties /app/config/node.properties
COPY config/protocol-parameters.json /config/protocol-parameters.json

FROM bloxbean/yaci-store:2.0.2.1@sha256:9a75cb006db1710a9de02b566de158d8d561058328b8e1219531d2c2c79778e9 AS history
COPY yaci/config/application.properties /app/config/application.properties
