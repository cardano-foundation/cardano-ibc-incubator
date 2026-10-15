#!/usr/bin/env bash
set -euo pipefail

# Use a fresh directory shared with Docker. Colima normally shares the home directory.
OUTPUT_DIR="${1:?provide a fresh output directory}"
REPO_DIR="$(git rev-parse --show-toplevel)"
SOURCE_TAG=v1.18.0-1770939123
SOURCE_COMMIT=6632cef271f7482f39f9c5d4b085adc1370e8b7e
APP_IMAGE="${INJECTIVE_PROBE_IMAGE:-local/cardano-injective-release}"
BUILDER_IMAGE="${INJECTIVE_PROBE_BUILDER_IMAGE:-local/cardano-injective-release-builder}"
HELPER_IMAGE="${INJECTIVE_PROBE_HELPER_IMAGE:-local/cardano-injective-release-probe}"

if [ -e "$OUTPUT_DIR" ]; then
  echo "Use a fresh output directory so existing node state cannot be changed." >&2
  exit 1
fi
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
git clone --depth 1 --branch "$SOURCE_TAG" https://github.com/InjectiveFoundation/injective-core.git "$OUTPUT_DIR/injective-source"
test "$(git -C "$OUTPUT_DIR/injective-source" rev-parse HEAD)" = "$SOURCE_COMMIT"
sh "$REPO_DIR/chains/cosmos/patch_cardano_probabilistic_light_client.sh" "$OUTPUT_DIR/injective-source" "$REPO_DIR"
docker build --build-arg GO_VERSION=1.26.5 -f "$REPO_DIR/chains/injective/configuration/Dockerfile" \
  -t "$APP_IMAGE" "$OUTPUT_DIR/injective-source"
docker build --target builder --build-arg GO_VERSION=1.26.5 -f "$REPO_DIR/chains/injective/configuration/Dockerfile" \
  -t "$BUILDER_IMAGE" "$OUTPUT_DIR/injective-source"
docker build --target "${INJECTIVE_PROBE_TARGET:-probe}" --build-arg "INJECTIVE_BUILDER_IMAGE=$BUILDER_IMAGE" --build-arg "INJECTIVE_IMAGE=$APP_IMAGE" \
  -f "$REPO_DIR/tests/injective-probabilistic-lifecycle/Dockerfile.probe" -t "$HELPER_IMAGE" \
  "$REPO_DIR/tests/injective-probabilistic-lifecycle"
cp -R "$REPO_DIR/tests/injective-probabilistic-lifecycle/evidence/network-snapshot" "$OUTPUT_DIR/network-snapshot"
docker run --rm "$HELPER_IMAGE" address > "$OUTPUT_DIR/operator-address.txt"
docker run --rm -v "$OUTPUT_DIR:/out" "$HELPER_IMAGE" key /out/operator-key.hex
for fixture in limit size; do
  cp "$REPO_DIR/cosmos/cardano-probabilistic-light-client-core/testdata/native-boundary-$fixture.json.gz" "$OUTPUT_DIR/"
  docker run --rm -v "$OUTPUT_DIR:/out" "$HELPER_IMAGE" prepare \
    "/out/native-boundary-$fixture.json.gz" expanded "/out/$fixture"
done
(
  cd "$REPO_DIR/cosmos/cardano-probabilistic-light-client-v8"
  GOWORK=off INJECTIVE_LIFECYCLE_FIXTURE_DIR="$OUTPUT_DIR/lifecycle" \
    INJECTIVE_LIFECYCLE_RECEIVER="$(cat "$OUTPUT_DIR/operator-address.txt")" \
    go test -run '^TestExportInjectiveLifecycleHistory$' -count=1 -v
)
docker run --rm -v "$OUTPUT_DIR:/out" "$HELPER_IMAGE" lifecycle /out/lifecycle normal /out/lifecycle
docker run --rm --entrypoint sh "$BUILDER_IMAGE" \
  -c 'sha256sum /usr/local/bin/injectived; go version -m /usr/local/bin/injectived' > "$OUTPUT_DIR/binary-build-info.txt"
git -C "$REPO_DIR" rev-parse HEAD > "$OUTPUT_DIR/module-commit.txt"
