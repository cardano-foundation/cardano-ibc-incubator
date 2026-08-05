VERSION 0.8

# Reusable tagging/push helpers from the Cardano Foundation GHA workflows.
# See: https://github.com/cardano-foundation/cf-gha-workflows
# Keep privileged local Docker operations tied to the exact helper revision
# reviewed alongside this repository. Update this SHA deliberately.
IMPORT --allow-privileged github.com/cardano-foundation/cf-gha-workflows/./earthfiles/functions:e02adcacc7178585dab0ca362adc83424654b324 AS functions

# Space-separated list of image targets built by `+all` / `+docker-publish`.
# NOTE: `injective` is excluded from the default list because its build context
# (chains/injective/injective-core) is neither vendored in this repo nor
# declared as a git submodule. Build it explicitly with `earthly +injective`
# once the injective-core source is provided.
# Gateway remains available as an explicit target, but its existing dedicated
# workflow owns CI and publication; these defaults add only the missing images.
ARG --global DOCKER_IMAGES_TARGETS="hermes swap-client"
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
# ChainEndpoint plus the Caribic binary for explicit-network relayer helpers.
# Build context is the repo root because the image compiles both `relayer/`
# and `caribic/`; CI checkouts must run with submodules: recursive.
# ---------------------------------------------------------------------------
hermes:
  ARG EARTHLY_TARGET_NAME
  LET DOCKER_IMAGE_NAME=${DOCKER_IMAGES_PREFIX}-hermes

  WAIT
    FROM DOCKERFILE -f docker/hermes-caribic.Dockerfile .
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
