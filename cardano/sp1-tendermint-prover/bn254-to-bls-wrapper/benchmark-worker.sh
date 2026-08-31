#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
key_dir="${1:-${script_dir}/../keys-local}"
fixture="${2:-${repo_root}/studies/sp1_tendermint_cardano/fixtures/update_client_fixture-groth16.json}"
runs="${3:-2}"

if [[ ! "${runs}" =~ ^[1-9][0-9]*$ ]]; then
  echo "runs must be a positive integer" >&2
  exit 2
fi
if [[ ! -f "${fixture}" ]]; then
  echo "fixture does not exist: ${fixture}" >&2
  exit 2
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_dir="${4:-${script_dir}/../artifacts-local/wrapper-worker-${timestamp}}"
mkdir -p "$(dirname "${output_dir}")"
mkdir "${output_dir}"

benchmark_tmp="$(mktemp -d)"
request_fifo="${benchmark_tmp}/requests.fifo"
response_fifo="${benchmark_tmp}/responses.fifo"
worker_binary="${benchmark_tmp}/bn254-to-bls-wrapper"
worker_pid=""

cleanup() {
  exec 3>&- 2>/dev/null || true
  exec 4>&- 2>/dev/null || true
  if [[ -n "${worker_pid}" ]] && kill -0 "${worker_pid}" 2>/dev/null; then
    kill "${worker_pid}" 2>/dev/null || true
    wait "${worker_pid}" 2>/dev/null || true
  fi
  rm -f "${worker_binary}" "${request_fifo}" "${response_fifo}"
  rmdir "${benchmark_tmp}" 2>/dev/null || true
}
trap cleanup EXIT

now_seconds() {
  perl -MTime::HiRes=clock_gettime,CLOCK_MONOTONIC \
    -e 'printf "%.9f\n", clock_gettime(CLOCK_MONOTONIC)'
}

elapsed_seconds() {
  awk -v start="$1" -v finish="$2" 'BEGIN { printf "%.9f\n", finish - start }'
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

host_model="unknown"
host_processor="unknown"
host_memory_bytes=""
host_os="$(uname -s) $(uname -r)"
if [[ "$(uname -s)" == "Darwin" ]]; then
  host_model="$(sysctl -n hw.model 2>/dev/null || echo unknown)"
  host_processor="$(system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/Chip:/ {print $2; exit}')"
  host_processor="${host_processor:-unknown}"
  host_memory_bytes="$(sysctl -n hw.memsize 2>/dev/null || true)"
  if command -v sw_vers >/dev/null 2>&1; then
    host_os="macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
  fi
elif [[ "$(uname -s)" == "Linux" ]]; then
  host_model="$(awk -F': *' '/Hardware|Model name/ {print $2; exit}' /proc/cpuinfo 2>/dev/null || true)"
  host_model="${host_model:-unknown}"
  host_processor="$(awk -F': *' '/model name/ {print $2; exit}' /proc/cpuinfo 2>/dev/null || true)"
  host_processor="${host_processor:-unknown}"
  memory_kib="$(awk '/MemTotal:/ {print $2; exit}' /proc/meminfo 2>/dev/null || true)"
  if [[ -n "${memory_kib}" ]]; then
    host_memory_bytes="$((memory_kib * 1024))"
  fi
fi

(cd "${script_dir}" && go build -o "${worker_binary}" .)
mkfifo "${request_fifo}" "${response_fifo}"

time_flavor="unavailable"
time_arguments=()
if [[ -x /usr/bin/time ]]; then
  if /usr/bin/time --version 2>/dev/null | grep -q GNU; then
    time_flavor="gnu-v"
    time_arguments=(-v)
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    time_flavor="darwin-l"
    time_arguments=(-l)
  fi
fi

started_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
started_seconds="$(now_seconds)"
if [[ "${time_flavor}" == "unavailable" ]]; then
  "${worker_binary}" -worker -key-dir "${key_dir}" \
    <"${request_fifo}" >"${response_fifo}" 2>"${output_dir}/worker.log" &
else
  /usr/bin/time "${time_arguments[@]}" \
    "${worker_binary}" -worker -key-dir "${key_dir}" \
    <"${request_fifo}" >"${response_fifo}" 2>"${output_dir}/worker.log" &
fi
worker_pid="$!"
# Opening the two parent FIFO endpoints releases the background process from
# its stdin and stdout redirections. Neither parent endpoint is inherited by
# the worker, so closing descriptor 3 after the final request produces EOF.
exec 3>"${request_fifo}"
exec 4<"${response_fifo}"

if ! IFS= read -r readiness <&4; then
  wait "${worker_pid}" 2>/dev/null || true
  worker_pid=""
  echo "worker exited before reporting readiness; see ${output_dir}/worker.log" >&2
  exit 1
fi
ready_seconds="$(now_seconds)"
printf '%s\n' "${readiness}" >"${output_dir}/responses.jsonl"

for ((index = 1; index <= runs; index++)); do
  request="$(jq -cn \
    --arg request_id "wrapper-${index}" \
    --arg fixture "${fixture}" \
    '{requestId: $request_id, fixturePath: $fixture}')"
  printf '%s\n' "${request}" >&3
  if ! IFS= read -r response <&4; then
    exec 3>&-
    wait "${worker_pid}" 2>/dev/null || true
    worker_pid=""
    echo "worker exited before response ${index}; see ${output_dir}/worker.log" >&2
    exit 1
  fi
  printf '%s\n' "${response}" >>"${output_dir}/responses.jsonl"
done

exec 3>&-
if ! wait "${worker_pid}"; then
  worker_pid=""
  echo "worker failed; see ${output_dir}/worker.log" >&2
  exit 1
fi
worker_pid=""
finished_seconds="$(now_seconds)"
finished_at_utc="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exec 4>&-

jq -es --argjson runs "${runs}" '
  .[0].ready == true and
  length == ($runs + 1) and
  ([.[1:][] | select(.ok == true)] | length) == $runs
' "${output_dir}/responses.jsonl" >/dev/null

startup_to_ready_seconds="$(elapsed_seconds "${started_seconds}" "${ready_seconds}")"
total_wall_seconds="$(elapsed_seconds "${started_seconds}" "${finished_seconds}")"
worker_reported_key_load_seconds="$(awk -F': *' '/^outer_key_load_seconds:/ {print $2; exit}' "${output_dir}/worker.log")"
worker_reported_key_load_seconds="${worker_reported_key_load_seconds:-null}"
maximum_resident_bytes="null"
if [[ "${time_flavor}" == "darwin-l" ]]; then
  rss="$(awk '/maximum resident set size/ {print $1; exit}' "${output_dir}/worker.log")"
  if [[ "${rss}" =~ ^[0-9]+$ ]]; then
    maximum_resident_bytes="${rss}"
  fi
elif [[ "${time_flavor}" == "gnu-v" ]]; then
  rss_kib="$(awk -F': *' '/Maximum resident set size \(kbytes\)/ {print $2; exit}' "${output_dir}/worker.log")"
  if [[ "${rss_kib}" =~ ^[0-9]+$ ]]; then
    maximum_resident_bytes="$((rss_kib * 1024))"
  fi
fi

host_memory_json="null"
if [[ "${host_memory_bytes}" =~ ^[0-9]+$ ]]; then
  host_memory_json="${host_memory_bytes}"
fi
proof_seconds="$(jq -cs '[.[1:][] | .elapsedSeconds]' "${output_dir}/responses.jsonl")"
protocol="$(jq -r '.protocol' "${output_dir}/responses.jsonl" | head -1)"
verification_key_sha256="$(jq -r '.verificationKeySha256' "${output_dir}/responses.jsonl" | head -1)"
fixture_sha256="$(sha256_file "${fixture}")"
worker_sha256="$(sha256_file "${worker_binary}")"
wrapper_source_sha256="$(sha256_file "${script_dir}/main.go")"
benchmark_script_sha256="$(sha256_file "${BASH_SOURCE[0]}")"
go_version="$(go version)"
gnark_version="$(cd "${script_dir}" && go list -m -f '{{.Version}}' github.com/consensys/gnark)"
gnark_crypto_version="$(cd "${script_dir}" && go list -m -f '{{.Version}}' github.com/consensys/gnark-crypto)"
jq_version="$(jq --version)"

jq -n \
  --arg run_id "wrapper-worker-${timestamp}" \
  --arg started_at_utc "${started_at_utc}" \
  --arg finished_at_utc "${finished_at_utc}" \
  --arg fixture "${fixture}" \
  --arg fixture_sha256 "${fixture_sha256}" \
  --arg key_dir "${key_dir}" \
  --arg protocol "${protocol}" \
  --arg verification_key_sha256 "${verification_key_sha256}" \
  --arg worker_sha256 "${worker_sha256}" \
  --arg time_flavor "${time_flavor}" \
  --arg host_model "${host_model}" \
  --arg host_processor "${host_processor}" \
  --arg host_os "${host_os}" \
  --arg architecture "$(uname -m)" \
  --arg go_version "${go_version}" \
  --arg gnark_version "${gnark_version}" \
  --arg gnark_crypto_version "${gnark_crypto_version}" \
  --arg jq_version "${jq_version}" \
  --arg wrapper_source_sha256 "${wrapper_source_sha256}" \
  --arg benchmark_script_sha256 "${benchmark_script_sha256}" \
  --argjson request_count "${runs}" \
  --argjson startup_to_ready_seconds "${startup_to_ready_seconds}" \
  --argjson worker_reported_key_load_seconds "${worker_reported_key_load_seconds}" \
  --argjson proof_seconds "${proof_seconds}" \
  --argjson total_wall_seconds "${total_wall_seconds}" \
  --argjson maximum_resident_bytes "${maximum_resident_bytes}" \
  --argjson host_memory_bytes "${host_memory_json}" \
  '{
    schemaVersion: 1,
    classification: "single-local-observation",
    runId: $run_id,
    startedAtUtc: $started_at_utc,
    finishedAtUtc: $finished_at_utc,
    fixture: {path: $fixture, sha256: $fixture_sha256},
    keyDirectory: $key_dir,
    requestCount: $request_count,
    timings: {
      processStartToReadinessSeconds: $startup_to_ready_seconds,
      workerReportedKeyLoadSeconds: $worker_reported_key_load_seconds,
      proofSeconds: $proof_seconds,
      processTotalWallSeconds: $total_wall_seconds
    },
    resources: {
      maximumResidentBytes: $maximum_resident_bytes,
      measurement: $time_flavor
    },
    host: {
      model: $host_model,
      processor: $host_processor,
      memoryBytes: $host_memory_bytes,
      operatingSystem: $host_os,
      architecture: $architecture
    },
    tools: {
      go: $go_version,
      gnark: $gnark_version,
      gnarkCrypto: $gnark_crypto_version,
      jq: $jq_version,
      workerBinarySha256: $worker_sha256,
      wrapperSourceSha256: $wrapper_source_sha256,
      benchmarkScriptSha256: $benchmark_script_sha256
    },
    worker: {
      protocol: $protocol,
      verificationKeySha256: $verification_key_sha256
    },
    artifacts: {
      responses: "responses.jsonl",
      log: "worker.log"
    }
  }' >"${output_dir}/summary.json"

echo "summary=${output_dir}/summary.json"
echo "responses=${output_dir}/responses.jsonl"
echo "worker_log=${output_dir}/worker.log"
jq '{classification, requestCount, timings, resources, host, tools, worker}' "${output_dir}/summary.json"
