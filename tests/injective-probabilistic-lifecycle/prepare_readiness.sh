#!/usr/bin/env bash
set -euo pipefail

OUTPUT_DIR="${1:?provide a fresh output directory shared with Docker}"
REPO_DIR="$(git rev-parse --show-toplevel)"
SOURCE_COMMIT=6632cef271f7482f39f9c5d4b085adc1370e8b7e
BUILDER_IMAGE="${READINESS_BUILDER_IMAGE:-local/injective-bounded-verification-builder}"
RUNTIME_IMAGE="${READINESS_RUNTIME_IMAGE:-local/injective-bounded-verification}"
NODE_IMAGE="${READINESS_NODE_IMAGE:-local/injective-readiness-node}"
PROBE_IMAGE="${READINESS_PROBE_IMAGE:-local/injective-readiness-probe}"
READINESS_TARGET="${READINESS_CARGO_TARGET_DIR:-$REPO_DIR/relayer/target}"

if [ -e "$OUTPUT_DIR" ]; then
  echo 'Use a fresh directory to preserve earlier evidence.' >&2
  exit 1
fi
mkdir -p "$OUTPUT_DIR/build" "$OUTPUT_DIR/live"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
git clone --depth 1 --branch v1.18.0-1770939123 https://github.com/InjectiveFoundation/injective-core.git "$OUTPUT_DIR/injective-source"
test "$(git -C "$OUTPUT_DIR/injective-source" rev-parse HEAD)" = "$SOURCE_COMMIT"
git -C "$OUTPUT_DIR/injective-source" archive --format=tar --output="$OUTPUT_DIR/build/injective-source.tar" "$SOURCE_COMMIT"

# These images provide the native build dependencies and runtime libraries.
# The readiness Dockerfile discards their source and rebuilds the application.
if ! docker image inspect "$BUILDER_IMAGE" >/dev/null 2>&1; then
  docker build --target builder --build-arg GO_VERSION=1.26.9 -f "$REPO_DIR/chains/injective/configuration/Dockerfile" -t "$BUILDER_IMAGE" "$OUTPUT_DIR/injective-source"
fi
if ! docker image inspect "$RUNTIME_IMAGE" >/dev/null 2>&1; then
  docker build --build-arg GO_VERSION=1.26.9 -f "$REPO_DIR/chains/injective/configuration/Dockerfile" -t "$RUNTIME_IMAGE" "$OUTPUT_DIR/injective-source"
fi
mkdir -p "$OUTPUT_DIR/build/cosmos"
cp -R "$REPO_DIR/cosmos/cardano-probabilistic-light-client-core" "$OUTPUT_DIR/build/cosmos/"
cp -R "$REPO_DIR/cosmos/cardano-probabilistic-light-client-v8" "$OUTPUT_DIR/build/cosmos/"
cp -R "$REPO_DIR/tests/injective-probabilistic-lifecycle/probe" "$OUTPUT_DIR/build/probe"
cp "$REPO_DIR/chains/cosmos/patch_cardano_probabilistic_light_client.sh" "$OUTPUT_DIR/build/patch.sh"
cp "$REPO_DIR/tests/injective-probabilistic-lifecycle/Dockerfile.readiness" "$OUTPUT_DIR/build/Dockerfile"
for target in node probe; do
  image="$NODE_IMAGE"
  if [ "$target" = probe ]; then image="$PROBE_IMAGE"; fi
  docker build --target "$target" --build-arg "INJECTIVE_BUILDER_IMAGE=$BUILDER_IMAGE" --build-arg "INJECTIVE_IMAGE=$RUNTIME_IMAGE" -f "$OUTPUT_DIR/build/Dockerfile" -t "$image" "$OUTPUT_DIR/build"
done
READINESS_CONTAINER="$(docker create "$NODE_IMAGE")"
cleanup_binary_container() {
  if [ -n "$READINESS_CONTAINER" ]; then docker rm "$READINESS_CONTAINER" >/dev/null; fi
}
trap cleanup_binary_container EXIT
docker cp "$READINESS_CONTAINER:/usr/local/bin/injectived" "$OUTPUT_DIR/injectived"
go version -m "$OUTPUT_DIR/injectived" > "$OUTPUT_DIR/native-build-info.txt"
docker rm "$READINESS_CONTAINER" >/dev/null
READINESS_CONTAINER=""
trap - EXIT
docker run --rm "$PROBE_IMAGE" address > "$OUTPUT_DIR/live/operator-address.txt"
(
  cd "$REPO_DIR/cosmos/cardano-probabilistic-light-client-v8"
  GOWORK=off INJECTIVE_LIFECYCLE_FIXTURE_DIR="$OUTPUT_DIR/live" \
    INJECTIVE_LIFECYCLE_RECEIVER="$(cat "$OUTPUT_DIR/live/operator-address.txt")" \
    CHECKPOINT_INITIAL_AGE=36h LIVE_READINESS_PROFILE=1 \
    go test -run '^TestExportInjectiveLifecycleHistory$' -count=1 -v
)
(
  cd "$REPO_DIR/cosmos/cardano-probabilistic-light-client-core"
  GOWORK=off go build -o "$OUTPUT_DIR/mithril-test-aggregator" ./mithril/mithriltest/cmd/aggregator
)
CARGO_TARGET_DIR="$READINESS_TARGET" cargo build --locked --manifest-path "$REPO_DIR/tests/challenge-capacity-relayer/Cargo.toml" --bin checkpoint-worker
for package in proto-types packages/cardano-ibc-trace-registry packages/cardano-ibc-tx-builder packages/cardano-ibc-planner packages/cardano-ibc-tx-builder-runtime; do
  npm ci --prefix "$REPO_DIR/$package"
  npm run --prefix "$REPO_DIR/$package" build
done
npm ci --prefix "$REPO_DIR/cardano/gateway"
node "$REPO_DIR/cardano/gateway/scripts/build-client-preparer.cjs"
git -C "$REPO_DIR" rev-parse HEAD > "$OUTPUT_DIR/module-commit.txt"
git -C "$REPO_DIR/relayer" rev-parse HEAD > "$OUTPUT_DIR/hermes-commit.txt"
docker image inspect "$NODE_IMAGE" "$PROBE_IMAGE" > "$OUTPUT_DIR/images.json"
python3 "$REPO_DIR/tests/injective-probabilistic-lifecycle/run_readiness.py" "$OUTPUT_DIR/live" \
  --node-image "$NODE_IMAGE" --probe-image "$PROBE_IMAGE" \
  --worker "$READINESS_TARGET/debug/checkpoint-worker" --aggregator "$OUTPUT_DIR/mithril-test-aggregator"
python3 "$REPO_DIR/tests/injective-probabilistic-lifecycle/retain_readiness.py" "$OUTPUT_DIR/live" "$OUTPUT_DIR/evidence" \
  --native-binary "$OUTPUT_DIR/injectived" --worker "$READINESS_TARGET/debug/checkpoint-worker"
