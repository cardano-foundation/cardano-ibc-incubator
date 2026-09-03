#!/usr/bin/env bash
set -euo pipefail

RUNNER_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH='' cd -- "$RUNNER_DIR/../../.." && pwd)
ELF_PATH="$REPO_ROOT/third_party/ibc-eureka/sp1-programs-v2.0.0/sp1-ics07-tendermint-update-client"
FIXTURE_SOURCE="$REPO_ROOT/cardano/gateway/src/scripts/test/fixtures/tendermint-update-capacity/source"

PROFILE=${1:-baseline}
MODE=${2:-compressed}
CASE=${3:-injective-45}
OUTPUT_ROOT=${4:-$RUNNER_DIR/artifacts-cpu}
RUN_ID="${PROFILE}-${MODE}-$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ROOT="$OUTPUT_ROOT/$RUN_ID"

case "$MODE" in
  execution) COMMAND=benchmark-execution ;;
  core) COMMAND=prove-cpu-core ;;
  compressed) COMMAND=prove-cpu-compressed ;;
  groth16) COMMAND=prove-cpu-groth16 ;;
  *) echo "unknown mode: $MODE (expected execution, core, compressed, or groth16)" >&2; exit 2 ;;
esac

TUNING_ENV_NAMES=(
  RAYON_NUM_THREADS
  TOKIO_WORKER_THREADS
  GOMAXPROCS
  GOGC
  GOMEMLIMIT
  RUSTFLAGS
  CARGO_PROFILE_RELEASE_LTO
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS
  MINIMAL_TRACE_CHUNK_THRESHOLD
  TRACE_CHUNK_SLOTS
  MEMORY_LIMIT
  SHARD_SIZE
  ELEMENT_THRESHOLD
  HEIGHT_THRESHOLD
  SP1_WORKER_NUM_SPLICING_WORKERS
  SP1_WORKER_SPLICING_BUFFER_SIZE
  SP1_WORKER_MAX_REDUCE_ARITY
  SP1_WORKER_NUMBER_OF_SEND_SPLICE_WORKERS_PER_SPLICE
  SP1_WORKER_SEND_SPLICE_INPUT_BUFFER_SIZE_PER_SPLICE
  SP1_WORKER_GLOBAL_MEMORY_BUFFER_SIZE
  SP1_WORKER_USE_FIXED_PK
  SP1_WORKER_VERIFY_INTERMEDIATES
  SP1_WORKER_NUM_CORE_WORKERS
  SP1_WORKER_CORE_BUFFER_SIZE
  SP1_WORKER_NUM_SETUP_WORKERS
  SP1_WORKER_SETUP_BUFFER_SIZE
  SP1_WORKER_NORMALIZE_PROGRAM_CACHE_SIZE
  SP1_WORKER_NUM_PREPARE_REDUCE_WORKERS
  SP1_WORKER_PREPARE_REDUCE_BUFFER_SIZE
  SP1_WORKER_NUM_RECURSION_EXECUTOR_WORKERS
  SP1_WORKER_RECURSION_EXECUTOR_BUFFER_SIZE
  SP1_WORKER_NUM_RECURSION_PROVER_WORKERS
  SP1_WORKER_RECURSION_PROVER_BUFFER_SIZE
  SP1_WORKER_MAX_COMPOSE_ARITY
  SP1_WORKER_NUM_DEFERRED_WORKERS
  SP1_WORKER_DEFERRED_BUFFER_SIZE
  SP1_CPU_BENCH_SAVE_BUNDLE
)
CLEAR_TUNING_ENV=()
for name in "${TUNING_ENV_NAMES[@]}"; do
  CLEAR_TUNING_ENV+=("-u" "$name")
done

RUNTIME_ENV=("RAYON_NUM_THREADS=10")
BUILD_ENV=()
case "$PROFILE" in
  baseline)
    ;;
  trace-16m)
    RUNTIME_ENV+=("MINIMAL_TRACE_CHUNK_THRESHOLD=16777216")
    ;;
  threads-8)
    RUNTIME_ENV=("RAYON_NUM_THREADS=8")
    ;;
  recursion-low)
    RUNTIME_ENV+=(
      "SP1_WORKER_NUM_PREPARE_REDUCE_WORKERS=2"
      "SP1_WORKER_PREPARE_REDUCE_BUFFER_SIZE=2"
      "SP1_WORKER_NUM_RECURSION_EXECUTOR_WORKERS=2"
      "SP1_WORKER_RECURSION_EXECUTOR_BUFFER_SIZE=2"
      "SP1_WORKER_NUM_RECURSION_PROVER_WORKERS=4"
      "SP1_WORKER_RECURSION_PROVER_BUFFER_SIZE=4"
    )
    ;;
  native)
    BUILD_ENV=(
      "RUSTFLAGS=-C target-cpu=native"
      "CARGO_PROFILE_RELEASE_LTO=thin"
      "CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1"
    )
    RUNTIME_ENV+=("${BUILD_ENV[@]}")
    ;;
  *)
    echo "unknown profile: $PROFILE (expected baseline, trace-16m, threads-8, recursion-low, or native)" >&2
    exit 2
    ;;
esac

mkdir -p "$RUN_ROOT"
env "${CLEAR_TUNING_ENV[@]}" "${BUILD_ENV[@]}" \
  cargo build --release --locked --manifest-path "$RUNNER_DIR/Cargo.toml"

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

{
  echo "profile=$PROFILE"
  echo "mode=$MODE"
  echo "case=$CASE"
  echo "run_id=$RUN_ID"
  echo "runner_binary_sha256=$(hash_file "$RUNNER_DIR/target/release/eureka-guest-runner")"
  echo "runner_source_sha256=$(hash_file "$RUNNER_DIR/src/main.rs")"
  uname -a
  rustc -Vv
  if [ "$(uname -s)" = Darwin ]; then
    sysctl -n hw.model machdep.cpu.brand_string hw.memsize hw.ncpu \
      hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu
    sw_vers
  fi
  printf 'runtime_env=%q ' "${RUNTIME_ENV[@]}"
  printf '\n'
} > "$RUN_ROOT/context.txt"

if [ "$(uname -s)" = Darwin ]; then
  TIME_ARGS=(-l)
else
  TIME_ARGS=(-v)
fi

env "${CLEAR_TUNING_ENV[@]}" "${RUNTIME_ENV[@]}" RUST_LOG="${RUST_LOG:-warn}" \
  /usr/bin/time "${TIME_ARGS[@]}" "$RUNNER_DIR/target/release/eureka-guest-runner" \
  "$ELF_PATH" "$FIXTURE_SOURCE" "$COMMAND" "$CASE" "$RUN_ROOT" 2>&1 | tee "$RUN_ROOT/run.log"

echo "benchmark=$RUN_ROOT"
