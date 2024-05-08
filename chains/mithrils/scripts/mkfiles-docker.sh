
# Mithril genesis keys
GENESIS_VERIFICATION_KEY=5b33322c3235332c3138362c3230312c3137372c31312c3131372c3133352c3138372c3136372c3138312c3138382c32322c35392c3230362c3130352c3233312c3135302c3231352c33302c37382c3231322c37362c31362c3235322c3138302c37322c3133342c3133372c3234372c3136312c36385d
GENESIS_SECRET_KEY=5b3131382c3138342c3232342c3137332c3136302c3234312c36312c3134342c36342c39332c3130362c3232392c38332c3133342c3138392c34302c3138392c3231302c32352c3138342c3136302c3134312c3233372c32362c3136382c35342c3233392c3230342c3133392c3131392c31332c3139395d
CHAIN_OBSERVER_TYPE=pallas
CARDANO_NODE_DIR=chains/cardano/devnet
CARDANO_NODE_VERSION=8.9.1
MITHRIL_DATA_DIR=chains/mithrils/data

cat >> docker-compose.yaml <<EOF
version: "3.9"

services:
EOF

cat >> docker-compose.yaml <<EOF
  mithril-aggregator:
    image: \${MITHRIL_AGGREGATOR_IMAGE}
    restart: always
    profiles:
      - mithril
    volumes:
      - ./${CARDANO_NODE_DIR}:/data:z
      - ./${MITHRIL_DATA_DIR}:/mithril:z
    networks:
      - mithril_network
    ports:
      - "8080:8080"
    environment:
      - RUST_BACKTRACE=1
      - GOOGLE_APPLICATION_CREDENTIALS_JSON=
      - NETWORK=devnet
      - NETWORK_MAGIC=42
      - PROTOCOL_PARAMETERS__K=5
      - PROTOCOL_PARAMETERS__M=100
      - PROTOCOL_PARAMETERS__PHI_F=0.65
      - RUN_INTERVAL=6000
      - URL_SNAPSHOT_MANIFEST=
      - SNAPSHOT_STORE_TYPE=local
      - SNAPSHOT_UPLOADER_TYPE=local
      - SNAPSHOT_COMPRESSION_ALGORITHM=zstandard
      - DATA_STORES_DIRECTORY=/mithril/aggregator/stores
      - CARDANO_NODE_SOCKET_PATH=/data/node.socket
      - CARDANO_NODE_VERSION=${CARDANO_NODE_VERSION}
      - CARDANO_CLI_PATH=/app/bin/cardano-cli
      - CHAIN_OBSERVER_TYPE=${CHAIN_OBSERVER_TYPE}
      - GENESIS_VERIFICATION_KEY=${GENESIS_VERIFICATION_KEY}
      - DB_DIRECTORY=/data/db
      - SNAPSHOT_DIRECTORY=/mithril/aggregator
      - SERVER_PORT=8080
      - SIGNED_ENTITY_TYPES=CardanoTransactions
      - CURRENT_ERA_EPOCH=0
      - ERA_ADAPTER_TYPE=bootstrap
    command:
      [
        "-vvv",
        "serve"
      ]

  mithril-aggregator-genesis:
    image: \${MITHRIL_AGGREGATOR_IMAGE}
    profiles:
      - mithril-genesis
    volumes:
      - ./${CARDANO_NODE_DIR}:/data:z
      - ./${MITHRIL_DATA_DIR}:/mithril:z
    networks:
    - mithril_network
    ports:
      - "8080:8080"
    environment:
      - RUST_BACKTRACE=1
      - GOOGLE_APPLICATION_CREDENTIALS_JSON=
      - NETWORK=devnet
      - NETWORK_MAGIC=42
      - PROTOCOL_PARAMETERS__K=5
      - PROTOCOL_PARAMETERS__M=100
      - PROTOCOL_PARAMETERS__PHI_F=0.65
      - RUN_INTERVAL=6000
      - URL_SNAPSHOT_MANIFEST=
      - SNAPSHOT_STORE_TYPE=local
      - SNAPSHOT_UPLOADER_TYPE=local
      - SNAPSHOT_COMPRESSION_ALGORITHM=zstandard
      - DATA_STORES_DIRECTORY=/mithril/aggregator/stores
      - CARDANO_NODE_SOCKET_PATH=/data/node.socket
      - CARDANO_NODE_VERSION=${CARDANO_NODE_VERSION}
      - CARDANO_CLI_PATH=/app/bin/cardano-cli
      - CHAIN_OBSERVER_TYPE=${CHAIN_OBSERVER_TYPE}
      - GENESIS_VERIFICATION_KEY=${GENESIS_VERIFICATION_KEY}
      - GENESIS_SECRET_KEY=${GENESIS_SECRET_KEY}
      - DB_DIRECTORY=/data/db
      - SNAPSHOT_DIRECTORY=/mithril/aggregator
      - SERVER_PORT=8080
      - SIGNED_ENTITY_TYPES=CardanoTransactions
      - CURRENT_ERA_EPOCH=0
      - ERA_ADAPTER_TYPE=bootstrap
    command:
      [
        "-vvv",
        "genesis",
        "bootstrap"
      ]
EOF

NUM_POOL_NODES=2
for (( i=1; i<=${NUM_POOL_NODES}; i++ )) do
cat >> docker-compose.yaml <<EOF
  mithril-signer-${i}:
    image: \${MITHRIL_SIGNER_IMAGE}
    restart: always
    profiles:
      - mithril
    volumes:
      - ./${CARDANO_NODE_DIR}:/data:z
      - ./${MITHRIL_DATA_DIR}:/mithril:z
    networks:
    - mithril_network
    environment:
      - RUST_BACKTRACE=1
      - AGGREGATOR_ENDPOINT=http://mithril-aggregator:8080/aggregator
      - NETWORK=devnet
      - NETWORK_MAGIC=42
      - RUN_INTERVAL=2000
      - DB_DIRECTORY=/data/db
      - DATA_STORES_DIRECTORY=/mithril/signer-${i}/stores
      - CARDANO_NODE_SOCKET_PATH=/data/node.socket
      - CARDANO_CLI_PATH=/app/bin/cardano-cli
      - KES_SECRET_KEY_PATH=/data/kes.skey
      - OPERATIONAL_CERTIFICATE_PATH=/data/opcert.cert
      - SIGNED_ENTITY_TYPES=CardanoTransactions
    command:
      [
        "-vvv"
      ]

EOF

done

cat >> docker-compose.yaml <<EOF
networks:
  mithril_network:
    driver: bridge
  cardano_network:
    driver: bridge
    
EOF
