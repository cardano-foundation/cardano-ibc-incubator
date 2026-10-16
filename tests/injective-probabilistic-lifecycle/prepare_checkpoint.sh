#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:?provide a fresh output directory shared with Docker}"
REPO_DIR="$(git rev-parse --show-toplevel)"
SOURCE_TAG=v1.18.0-1770939123
SOURCE_COMMIT=6632cef271f7482f39f9c5d4b085adc1370e8b7e
BASE_IMAGE=local/injective-checkpoint-base
BUILDER_IMAGE=local/injective-checkpoint-builder
if [ -e "$OUTPUT_DIR" ]; then
  echo 'Use a fresh directory to preserve existing evidence.' >&2
  exit 1
fi
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
git clone --depth 1 --branch "$SOURCE_TAG" https://github.com/InjectiveFoundation/injective-core.git "$OUTPUT_DIR/injective-source"
test "$(git -C "$OUTPUT_DIR/injective-source" rev-parse HEAD)" = "$SOURCE_COMMIT"
sh "$REPO_DIR/chains/cosmos/patch_cardano_probabilistic_light_client.sh" "$OUTPUT_DIR/injective-source" "$REPO_DIR"
docker build --build-arg GO_VERSION=1.26.9 -f "$REPO_DIR/chains/injective/configuration/Dockerfile" -t "$BASE_IMAGE" "$OUTPUT_DIR/injective-source"
docker build --target builder --build-arg GO_VERSION=1.26.9 -f "$REPO_DIR/chains/injective/configuration/Dockerfile" -t "$BUILDER_IMAGE" "$OUTPUT_DIR/injective-source"
docker build --target node --build-arg "INJECTIVE_BUILDER_IMAGE=$BUILDER_IMAGE" --build-arg "INJECTIVE_IMAGE=$BASE_IMAGE" \
  -f "$REPO_DIR/tests/injective-probabilistic-lifecycle/Dockerfile.checkpoint" -t local/injective-checkpoint-expiry "$REPO_DIR"
docker build --target probe --build-arg "INJECTIVE_BUILDER_IMAGE=$BUILDER_IMAGE" --build-arg "INJECTIVE_IMAGE=$BASE_IMAGE" \
  --build-context "probe_src=$REPO_DIR/tests/injective-probabilistic-lifecycle/probe" \
  -f "$REPO_DIR/tests/injective-probabilistic-lifecycle/Dockerfile.checkpoint" -t local/injective-checkpoint-probe "$REPO_DIR"
cp -R "$REPO_DIR/tests/injective-probabilistic-lifecycle/evidence/network-snapshot" "$OUTPUT_DIR/network-snapshot"
docker run --rm local/injective-checkpoint-probe address > "$OUTPUT_DIR/operator-address.txt"
docker run --rm -v "$OUTPUT_DIR:/out" local/injective-checkpoint-probe key /out/operator-key.hex
(
  cd "$REPO_DIR/cosmos/cardano-probabilistic-light-client-v8"
  IDLE_CHECKPOINT_FIXTURE_DIR="$OUTPUT_DIR" INJECTIVE_LIFECYCLE_RECEIVER="$(cat "$OUTPUT_DIR/operator-address.txt")" \
    GOWORK=off go test -run '^TestExportIdleCheckpointHistory$' -count=1 -v
  IDLE_CHECKPOINT_FIXTURE_DIR="$OUTPUT_DIR" GOWORK=off go test -run '^TestExportIdleCheckpointAuxiliaryProofs$' -count=1 -v
)
cp "$REPO_DIR/tests/injective-probabilistic-lifecycle/checkpoint-manifest.json" "$OUTPUT_DIR/fixture-manifest.json"
git -C "$REPO_DIR" rev-parse HEAD > "$OUTPUT_DIR/module-commit.txt"
git -C "$REPO_DIR/relayer" rev-parse HEAD > "$OUTPUT_DIR/hermes-commit.txt"
docker run --rm --entrypoint sh local/injective-checkpoint-expiry \
  -c 'sha256sum /usr/local/bin/injectived; go version -m /usr/local/bin/injectived' > "$OUTPUT_DIR/binary-build-info.txt"
