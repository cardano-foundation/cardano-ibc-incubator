FROM bloxbean/yaci-cli:0.10.6@sha256:054643c8a2b6610c40beee492505344e87761860ef60c3abadd02102fac06a03 AS devkit-tools

# Use the same dynamically linked node as the maintained local profile. The
# bundled static node cannot use the local clock required by pool-age policy.
FROM ghcr.io/blinklabs-io/cardano-node:10.1.4-3@sha256:62b157213fe4d2987582cd878222cfe1bf0172a1c983d188e37c45e693ac0ab9 AS devkit
RUN apt-get update \
    && apt-get install -y --no-install-recommends libfaketime python3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=devkit-tools /app /app
RUN ln -sf /profile/cardano_node.py /app/cardano-bin/cardano-node \
    && mv /app/cardano-bin/cardano-cli /app/cardano-bin/cardano-cli.bin
COPY devkit/cardano-cli.sh /app/cardano-bin/cardano-cli
RUN chmod +x /app/cardano-bin/cardano-cli
ENV PATH="/app/cardano-bin:${PATH}"
ENV CARDANO_NODE_SOCKET_PATH=/clusters/nodes/default/node/node.sock
ENV PROTOCOL_MAGIC=42
WORKDIR /app
COPY devkit/entrypoint.sh /profile/entrypoint.sh
COPY devkit/nonce.py /profile/nonce.py
COPY devkit/admin_proxy.py /profile/admin_proxy.py
COPY devkit/cardano_node.py /profile/cardano_node.py
RUN chmod +x /profile/cardano_node.py
COPY devkit/node.properties /app/config/node.properties

FROM bloxbean/yaci-store:2.0.2.1@sha256:9a75cb006db1710a9de02b566de158d8d561058328b8e1219531d2c2c79778e9 AS history
COPY yaci/config/application.properties /app/config/application.properties
