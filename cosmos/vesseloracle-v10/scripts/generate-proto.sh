#!/usr/bin/env bash
set -o errexit -o nounset -o pipefail

vessel_module_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
vessel_proto_dir="$vessel_module_dir/proto"
vessel_generated_dir="$(mktemp -d)"

cleanup() {
  rm -rf -- "$vessel_generated_dir"
}
trap cleanup EXIT

for vessel_tool in buf protoc-gen-gocosmos protoc-gen-grpc-gateway; do
  if ! command -v "$vessel_tool" >/dev/null; then
    echo "Missing required protobuf tool: $vessel_tool" >&2
    exit 1
  fi
done

(
  cd "$vessel_proto_dir"
  buf lint
  buf generate --template buf.gen.gogo.yaml --output "$vessel_generated_dir"
)

cp "$vessel_generated_dir"/vesseloracle/vesseloracle/*.go \
  "$vessel_module_dir/x/vesseloracle/types/"
gofmt -w "$vessel_module_dir/x/vesseloracle/types/"*.pb.go
