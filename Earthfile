VERSION 0.8

# Reusable tagging/push helpers from the Cardano Foundation GHA workflows.
# See: https://github.com/cardano-foundation/cf-gha-workflows
IMPORT --allow-privileged github.com/cardano-foundation/cf-gha-workflows/./earthfiles/functions:main AS functions

# Space-separated list of image targets built by `+all` / `+docker-publish`.
# NOTE: `injective` is excluded from the default list because its build context
# (chains/injective/injective-core) is neither vendored in this repo nor
# declared as a git submodule. Build it explicitly with `earthly +injective`
# once the injective-core source is provided.
ARG --global DOCKER_IMAGES_TARGETS="gateway hermes swap-client explorer"
ARG --global DOCKER_IMAGES_PREFIX="cardano-ibc"
ARG --global DOCKER_IMAGES_EXTRA_TAGS=""
ARG --global DOCKER_REGISTRIES=""
ARG --global PUSH=false

all:
  LOCALLY
  FOR image_target IN $DOCKER_IMAGES_TARGETS
    BUILD +$image_target --PUSH=$PUSH
  END

docker-publish:
  BUILD +all --PUSH=$PUSH

# ---------------------------------------------------------------------------
# Gateway (NestJS/TypeScript) — serves tx/query gRPC to the relayer.
# Dockerfile context is the repo root: it copies proto-types, packages,
# manifests, and cardano/gateway.
# ---------------------------------------------------------------------------
gateway:
  ARG EARTHLY_TARGET_NAME
  LET DOCKER_IMAGE_NAME=${DOCKER_IMAGES_PREFIX}-gateway

  WAIT
    FROM DOCKERFILE -f cardano/gateway/Dockerfile .
  END
  WAIT
    SAVE IMAGE ${DOCKER_IMAGE_NAME}
  END
  DO functions+DOCKER_TAG_N_PUSH \
     --PUSH=$PUSH \
     --DOCKER_IMAGE_NAME=${DOCKER_IMAGE_NAME} \
     --DOCKER_IMAGES_EXTRA_TAGS="${DOCKER_IMAGES_EXTRA_TAGS}" \
     --DOCKER_REGISTRIES="${DOCKER_REGISTRIES}"

# ---------------------------------------------------------------------------
# Hermes relayer (Rust) — forked relayer with the native Cardano
# ChainEndpoint. Built from the `relayer/` git submodule, so the checkout
# must run with submodules: recursive.
# ---------------------------------------------------------------------------
hermes:
  ARG EARTHLY_TARGET_NAME
  LET DOCKER_IMAGE_NAME=${DOCKER_IMAGES_PREFIX}-hermes

  WAIT
    FROM DOCKERFILE -f docker/hermes/Dockerfile relayer
  END
  WAIT
    SAVE IMAGE ${DOCKER_IMAGE_NAME}
  END
  DO functions+DOCKER_TAG_N_PUSH \
     --PUSH=$PUSH \
     --DOCKER_IMAGE_NAME=${DOCKER_IMAGE_NAME} \
     --DOCKER_IMAGES_EXTRA_TAGS="${DOCKER_IMAGES_EXTRA_TAGS}" \
     --DOCKER_REGISTRIES="${DOCKER_REGISTRIES}"

# ---------------------------------------------------------------------------
# IBC swap client (Next.js dApp). Dockerfile context is the repo root: it
# copies packages/* alongside dapps/ibc-swap/client.
# ---------------------------------------------------------------------------
swap-client:
  ARG EARTHLY_TARGET_NAME
  LET DOCKER_IMAGE_NAME=${DOCKER_IMAGES_PREFIX}-swap-client

  WAIT
    FROM DOCKERFILE -f dapps/ibc-swap/client/Dockerfile .
  END
  WAIT
    SAVE IMAGE ${DOCKER_IMAGE_NAME}
  END
  DO functions+DOCKER_TAG_N_PUSH \
     --PUSH=$PUSH \
     --DOCKER_IMAGE_NAME=${DOCKER_IMAGE_NAME} \
     --DOCKER_IMAGES_EXTRA_TAGS="${DOCKER_IMAGES_EXTRA_TAGS}" \
     --DOCKER_REGISTRIES="${DOCKER_REGISTRIES}"

# ---------------------------------------------------------------------------
# IBC explorer (dApp). Dockerfile context is dapps/ibc-explorer.
# ---------------------------------------------------------------------------
explorer:
  ARG EARTHLY_TARGET_NAME
  LET DOCKER_IMAGE_NAME=${DOCKER_IMAGES_PREFIX}-explorer

  WAIT
    FROM DOCKERFILE dapps/ibc-explorer
  END
  WAIT
    SAVE IMAGE ${DOCKER_IMAGE_NAME}
  END
  DO functions+DOCKER_TAG_N_PUSH \
     --PUSH=$PUSH \
     --DOCKER_IMAGE_NAME=${DOCKER_IMAGE_NAME} \
     --DOCKER_IMAGES_EXTRA_TAGS="${DOCKER_IMAGES_EXTRA_TAGS}" \
     --DOCKER_REGISTRIES="${DOCKER_REGISTRIES}"
